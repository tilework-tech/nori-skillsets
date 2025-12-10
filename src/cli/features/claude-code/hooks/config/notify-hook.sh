#!/bin/bash

# Hook script for sending desktop notifications
# This script is called by Claude Code Notification hooks
# Supports Linux (notify-send), macOS (osascript), and Windows (PowerShell)

# Derive install directory from script location
# Script is at .claude/hooks/notify-hook.sh, so go up two directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Configuration
readonly LOG_FILE="$INSTALL_DIR/.nori-notifications.log"
readonly NOTIFICATION_TITLE="Nori-Notification"
readonly DEFAULT_MESSAGE="Claude Code needs your attention"
readonly NOTIFICATION_TIMEOUT=5000
readonly NOTIFICATION_GROUP="nori-notifications"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Error handling function
log_error() {
    log "ERROR: $*"
    echo "Error: $*" >&2
}

# Read the notification data from stdin
NOTIFICATION_DATA=$(cat)
log "Received notification: $NOTIFICATION_DATA"

# Streamlined JSON parsing with fallback methods
parse_json_message() {
    local json="$1"
    local message=""
    
    # Try python3 first (most reliable for JSON)
    if command -v python3 >/dev/null 2>&1; then
        message=$(echo "$json" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print(data.get('message', ''))
except:
    pass
" 2>/dev/null)
    fi
    
    # Try jq if available and python3 failed
    if [ -z "$message" ] && command -v jq >/dev/null 2>&1; then
        message=$(echo "$json" | jq -r '.message // empty' 2>/dev/null)
    fi
    
    # Try node if available and previous methods failed
    if [ -z "$message" ] && command -v node >/dev/null 2>&1; then
        message=$(echo "$json" | node -e "
try {
    const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    console.log(data.message || '');
} catch (e) {}
" 2>/dev/null)
    fi
    
    # Final fallback using sed for simple JSON
    if [ -z "$message" ]; then
        message=$(echo "$json" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    fi
    
    echo "$message"
}

# Parse message and apply defaults
MESSAGE=$(parse_json_message "$NOTIFICATION_DATA")
[ -z "$MESSAGE" ] && MESSAGE="$DEFAULT_MESSAGE"
log "Using message: '$MESSAGE'"

# Cache OS detection
readonly OS_TYPE=$(uname -s)

# Capture current terminal window ID (Linux X11 only)
get_terminal_window_id() {
    # Only works on X11, not Wayland
    if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
        echo ""
        return
    fi

    # Try xdotool first (most reliable)
    if command -v xdotool >/dev/null 2>&1; then
        xdotool getactivewindow 2>/dev/null || echo ""
    else
        echo ""
    fi
}

# Detect macOS terminal application bundle ID
get_macos_terminal_bundle() {
    # Use TERM_PROGRAM environment variable if available
    case "$TERM_PROGRAM" in
        "Apple_Terminal")
            echo "com.apple.Terminal"
            ;;
        "iTerm.app")
            echo "com.googlecode.iterm2"
            ;;
        "WezTerm")
            echo "com.github.wez.wezterm"
            ;;
        "Alacritty")
            echo "org.alacritty"
            ;;
        "kitty")
            echo "net.kovidgoyal.kitty"
            ;;
        *)
            # Default to Terminal.app
            echo "com.apple.Terminal"
            ;;
    esac
}

# Platform-specific notification functions
send_linux_notification() {
    local title="$1"
    local message="$2"
    local window_id="$3"

    if ! command -v notify-send >/dev/null 2>&1; then
        log_error "notify-send not found on Linux system"
        cat >&2 << EOF
Warning: notify-send not found. Install libnotify-bin to enable desktop notifications.
  Ubuntu/Debian: sudo apt-get install libnotify-bin
  Fedora: sudo dnf install libnotify
  Arch: sudo pacman -S libnotify
EOF
        return 1
    fi

    # Check if we're on Wayland (no click actions supported yet)
    if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
        log "Wayland detected - using basic notification without click actions"
        if notify-send "$title" "$message" --icon=info --urgency=normal --expire-time="$NOTIFICATION_TIMEOUT" 2>>"$LOG_FILE"; then
            log "Linux notification sent successfully (Wayland mode)"
            return 0
        elif notify-send "$title" "$message" 2>>"$LOG_FILE"; then
            log "Linux notification sent with basic options (Wayland mode)"
            return 0
        else
            log_error "Linux notify-send failed"
            return 1
        fi
    fi

    # X11 mode: Try to use click actions if available
    if [ -n "$window_id" ]; then
        log "Attempting notification with click action (window ID: $window_id)"

        # Try with --action flag (requires recent libnotify)
        local result
        result=$(notify-send --action 'default=Click to return to terminal' "$title" "$message" --icon=info --urgency=normal --expire-time="$NOTIFICATION_TIMEOUT" 2>>"$LOG_FILE")
        local notify_exit=$?

        if [ $notify_exit -eq 0 ]; then
            log "Notification sent with action support"

            # Check if user clicked the notification
            if [ "$result" = "default" ]; then
                log "User clicked notification, restoring terminal focus"

                # Try wmctrl first, then xdotool
                if command -v wmctrl >/dev/null 2>&1; then
                    wmctrl -i -a "$window_id" 2>>"$LOG_FILE" && log "Focus restored with wmctrl"
                elif command -v xdotool >/dev/null 2>&1; then
                    xdotool windowactivate "$window_id" 2>>"$LOG_FILE" && log "Focus restored with xdotool"
                else
                    log_error "No window manager tool (wmctrl/xdotool) available for focus restoration"
                fi
            fi
            return 0
        else
            log "notify-send --action not supported, falling back to basic notification"
        fi
    fi

    # Fallback: basic notification without click action
    if notify-send "$title" "$message" --icon=info --urgency=normal --expire-time="$NOTIFICATION_TIMEOUT" 2>>"$LOG_FILE"; then
        log "Linux notification sent successfully (basic mode)"
    elif notify-send "$title" "$message" 2>>"$LOG_FILE"; then
        log "Linux notification sent with minimal options"
    else
        log_error "Linux notify-send failed"
        return 1
    fi
}

send_macos_notification() {
    local title="$1"
    local message="$2"

    # Escape quotes for AppleScript
    local escaped_title=$(echo "$title" | sed 's/"/\\"/g')
    local escaped_message=$(echo "$message" | sed 's/"/\\"/g')

    # Try terminal-notifier first (supports click-to-focus)
    if command -v terminal-notifier >/dev/null 2>&1; then
        local bundle_id=$(get_macos_terminal_bundle)
        log "Using terminal-notifier with bundle ID: $bundle_id"

        if terminal-notifier \
            -title "$title" \
            -message "$message - Click to return to terminal" \
            -activate "$bundle_id" \
            -sound default \
            -group "$NOTIFICATION_GROUP" 2>>"$LOG_FILE"; then
            log "macOS terminal-notifier notification sent successfully"
            return 0
        else
            log "terminal-notifier failed, falling back to osascript"
        fi
    else
        log "terminal-notifier not available (install with: brew install terminal-notifier)"
    fi

    # Fallback: Try direct osascript (not clickable)
    if osascript -e "display notification \"$escaped_message\" with title \"$escaped_title\"" 2>>"$LOG_FILE"; then
        log "macOS osascript notification sent (not clickable)"
        return 0
    fi

    log "Direct method failed, trying temp file approach"

    # Use temp file for complex messages
    local temp_script=$(mktemp /tmp/nori-notify.XXXXXX)
    printf 'display notification "%s" with title "%s"\n' \
        "$(echo "$message" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')" \
        "$(echo "$title" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')" > "$temp_script"

    if osascript "$temp_script" 2>>"$LOG_FILE"; then
        log "macOS temp file notification sent (not clickable)"
        rm -f "$temp_script"
        return 0
    fi

    rm -f "$temp_script"
    log_error "All macOS notification methods failed"
    return 1
}

send_windows_notification() {
    local title="$1"
    local message="$2"
    
    # Escape single quotes for PowerShell
    local ps_title=$(echo "$title" | sed "s/'/\\\\''/g")
    local ps_message=$(echo "$message" | sed "s/'/\\\\''/g")
    
    # Try BurntToast module first (modern Windows)
    if powershell.exe -Command "Get-Module -ListAvailable BurntToast" 2>>"$LOG_FILE" | grep -q "BurntToast"; then
        if powershell.exe -Command "New-BurntToastNotification -Text '$ps_title', '$ps_message'" 2>>"$LOG_FILE"; then
            log "Windows BurntToast notification sent successfully"
            return 0
        fi
        log "BurntToast failed, trying Windows Forms fallback"
    fi
    
    # Windows Forms fallback
    local forms_cmd="try { Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; \$notify = New-Object System.Windows.Forms.NotifyIcon; \$notify.Icon = [System.Drawing.SystemIcons]::Information; \$notify.Visible = \$true; \$notify.ShowBalloonTip($NOTIFICATION_TIMEOUT, '$ps_title', '$ps_message', [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 1; \$notify.Dispose(); } catch { Write-Error \$_.Exception.Message; exit 1 }"
    
    if powershell.exe -Command "$forms_cmd" 2>>"$LOG_FILE"; then
        log "Windows Forms notification sent successfully"
        return 0
    fi
    
    log "Windows Forms failed, trying msg.exe fallback"
    
    # Final fallback using msg command
    if command -v msg.exe >/dev/null 2>&1; then
        if msg.exe "%username%" "$ps_title: $ps_message" 2>>"$LOG_FILE"; then
            log "Used msg.exe as final fallback"
            return 0
        fi
    fi
    
    log_error "All Windows notification methods failed"
    return 1
}

# Capture terminal window context (if applicable)
TERMINAL_WINDOW_ID=""
case "$OS_TYPE" in
    Linux*)
        TERMINAL_WINDOW_ID=$(get_terminal_window_id)
        if [ -n "$TERMINAL_WINDOW_ID" ]; then
            log "Captured terminal window ID: $TERMINAL_WINDOW_ID"
        else
            log "Could not capture terminal window ID (Wayland or xdotool not available)"
        fi
        ;;
esac

# Send notification based on OS
case "$OS_TYPE" in
    Linux*)
        log "Sending Linux notification"
        send_linux_notification "$NOTIFICATION_TITLE" "$MESSAGE" "$TERMINAL_WINDOW_ID"
        ;;
    Darwin*)
        log "Sending macOS notification"
        send_macos_notification "$NOTIFICATION_TITLE" "$MESSAGE"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        log "Sending Windows notification"
        send_windows_notification "$NOTIFICATION_TITLE" "$MESSAGE"
        ;;
    *)
        log_error "Unsupported operating system: $OS_TYPE"
        echo "Warning: Unsupported operating system '$OS_TYPE' for desktop notifications" >&2
        exit 0
        ;;
esac

# Always exit successfully to avoid blocking Claude Code
log "Notification hook completed"
exit 0
