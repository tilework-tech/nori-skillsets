#!/usr/bin/env bash
# test_tui_scripts.sh: Verify TUI puppeteering scripts work correctly
#
# Run: bash test_tui_scripts.sh
#
# Prerequisites: tmux installed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION="test-tui-$$"
PASS=0
FAIL=0

cleanup() {
    "$SCRIPT_DIR/tui-stop" "$SESSION" 2>/dev/null || true
    "$SCRIPT_DIR/tui-stop" "${SESSION}-2" 2>/dev/null || true
    rm -f "${SESSION}_failure.log" /tmp/tui-capture-test.txt
}
trap cleanup EXIT

pass() {
    echo "  ✓ $1"
    ((PASS++))
}

fail() {
    echo "  ✗ $1"
    ((FAIL++))
}

echo "=== TUI Puppeteering Test Suite ==="
echo

# =============================================================================
# ERROR HANDLING TESTS
# =============================================================================
echo "Testing error handling..."

# tui-start: missing arguments
if ! "$SCRIPT_DIR/tui-start" 2>/dev/null; then
    pass "tui-start fails without arguments"
else
    fail "tui-start should fail without arguments"
fi

# tui-send: missing session
if ! "$SCRIPT_DIR/tui-send" 2>/dev/null; then
    pass "tui-send fails without arguments"
else
    fail "tui-send should fail without arguments"
fi

# tui-capture: missing session
if ! "$SCRIPT_DIR/tui-capture" 2>/dev/null; then
    pass "tui-capture fails without arguments"
else
    fail "tui-capture should fail without arguments"
fi

# tui-assert: missing arguments
if ! "$SCRIPT_DIR/tui-assert" 2>/dev/null; then
    pass "tui-assert fails without arguments"
else
    fail "tui-assert should fail without arguments"
fi

# Operations on non-existent session
if ! "$SCRIPT_DIR/tui-send" "nonexistent-session-xyz" "hello" 2>/dev/null; then
    pass "tui-send fails on non-existent session"
else
    fail "tui-send should fail on non-existent session"
fi

if ! "$SCRIPT_DIR/tui-capture" "nonexistent-session-xyz" 2>/dev/null; then
    pass "tui-capture fails on non-existent session"
else
    fail "tui-capture should fail on non-existent session"
fi

# =============================================================================
# ISOLATION VERIFICATION
# =============================================================================
echo "Testing isolation..."

# Verify scripts use nori-agent-sock (check tmux-isolated wrapper)
if grep -q "nori-agent-sock" "$SCRIPT_DIR/tmux-isolated"; then
    pass "tmux-isolated uses nori-agent-sock"
else
    fail "tmux-isolated should use nori-agent-sock"
fi

# Verify -f /dev/null in wrapper (no user config)
if grep -q "\-f /dev/null" "$SCRIPT_DIR/tmux-isolated"; then
    pass "tmux-isolated disables user config"
else
    fail "tmux-isolated should use -f /dev/null"
fi

# =============================================================================
# BASIC FUNCTIONALITY
# =============================================================================
echo "Testing tmux-isolated..."

if "$SCRIPT_DIR/tmux-isolated" -V >/dev/null 2>&1; then
    pass "tmux-isolated runs tmux"
else
    fail "tmux-isolated failed to run"
fi

echo "Testing tui-start..."

if output=$("$SCRIPT_DIR/tui-start" "$SESSION" "bash" 2>&1); then
    pass "tui-start creates session"
else
    fail "tui-start failed: $output"
fi

if "$SCRIPT_DIR/tmux-isolated" has-session -t "$SESSION" 2>/dev/null; then
    pass "session exists after tui-start"
else
    fail "session not found after tui-start"
fi

# tui-start replaces existing session (not error)
if "$SCRIPT_DIR/tui-start" "$SESSION" "bash" 2>&1; then
    pass "tui-start replaces existing session"
else
    fail "tui-start should replace existing session"
fi

# =============================================================================
# TUI-CAPTURE BASIC
# =============================================================================
echo "Testing tui-capture..."

sleep 0.5  # Let bash prompt render

if output=$("$SCRIPT_DIR/tui-capture" "$SESSION" 2>&1); then
    pass "tui-capture returns content"
else
    fail "tui-capture failed: $output"
fi

# =============================================================================
# TUI-SEND TESTS
# =============================================================================
echo "Testing tui-send..."

if "$SCRIPT_DIR/tui-send" "$SESSION" "echo TESTMARKER123" 2>&1; then
    pass "tui-send accepts text"
else
    fail "tui-send text failed"
fi

# tui-send with --keys
if "$SCRIPT_DIR/tui-send" "$SESSION" --keys "Enter" 2>&1; then
    pass "tui-send --keys works"
else
    fail "tui-send --keys failed"
fi

sleep 0.3

# tui-send with special characters (real-world input)
"$SCRIPT_DIR/tui-send" "$SESSION" 'echo "hello $USER"'
"$SCRIPT_DIR/tui-send" "$SESSION" --keys "Enter"
sleep 0.3

if "$SCRIPT_DIR/tui-assert" "$SESSION" 'echo "hello $USER"' 2 2>&1; then
    pass "tui-send handles special chars (\$, quotes)"
else
    fail "tui-send special chars failed"
fi

# tui-send text that looks like a flag (edge case)
"$SCRIPT_DIR/tui-send" "$SESSION" "echo --keys"
"$SCRIPT_DIR/tui-send" "$SESSION" --keys "Enter"
sleep 0.3

if "$SCRIPT_DIR/tui-assert" "$SESSION" "echo --keys" 2 2>&1; then
    pass "tui-send handles text resembling flags"
else
    fail "tui-send flag-like text failed"
fi

# =============================================================================
# TUI-ASSERT TESTS
# =============================================================================
echo "Testing tui-assert..."

if "$SCRIPT_DIR/tui-assert" "$SESSION" "TESTMARKER123" 3 2>&1; then
    pass "tui-assert finds text"
else
    fail "tui-assert did not find expected text"
fi

# tui-assert timeout case
if ! "$SCRIPT_DIR/tui-assert" "$SESSION" "NONEXISTENT_xyz_999" 1 2>/dev/null; then
    pass "tui-assert times out on missing text"
else
    fail "tui-assert should have timed out"
fi

if [[ -f "${SESSION}_failure.log" ]]; then
    pass "tui-assert creates failure log on timeout"
    rm -f "${SESSION}_failure.log"
else
    fail "tui-assert did not create failure log"
fi

# tui-assert with zero timeout (should fail immediately)
START_TIME=$SECONDS
if ! "$SCRIPT_DIR/tui-assert" "$SESSION" "IMPOSSIBLE_TEXT_xyz" 0 2>/dev/null; then
    ELAPSED=$((SECONDS - START_TIME))
    if [[ $ELAPSED -lt 2 ]]; then
        pass "tui-assert with timeout=0 fails immediately"
    else
        fail "tui-assert timeout=0 took too long ($ELAPSED s)"
    fi
else
    fail "tui-assert timeout=0 should fail"
fi
rm -f "${SESSION}_failure.log"

# tui-assert with regex
echo "Testing tui-assert regex..."

"$SCRIPT_DIR/tui-send" "$SESSION" "echo 'Error: code 42'"
"$SCRIPT_DIR/tui-send" "$SESSION" --keys "Enter"
sleep 0.3

if "$SCRIPT_DIR/tui-assert" "$SESSION" -E "Error:.*42" 3 2>&1; then
    pass "tui-assert -E matches regex"
else
    fail "tui-assert -E regex failed"
fi

# tui-assert regex that wouldn't match as fixed string
if "$SCRIPT_DIR/tui-assert" "$SESSION" -E "code [0-9]+" 3 2>&1; then
    pass "tui-assert -E uses actual regex"
else
    fail "tui-assert -E should match regex pattern"
fi

# =============================================================================
# TUI-CAPTURE FLAG TESTS
# =============================================================================
echo "Testing tui-capture flags..."

"$SCRIPT_DIR/tui-send" "$SESSION" 'echo -e "\033[31mRED\033[0m"'
"$SCRIPT_DIR/tui-send" "$SESSION" --keys "Enter"
sleep 0.3

# tui-capture with -e (ANSI)
if output=$("$SCRIPT_DIR/tui-capture" "$SESSION" -e 2>&1) && [[ "$output" == *$'\033'* ]]; then
    pass "tui-capture -e preserves ANSI codes"
else
    fail "tui-capture -e did not preserve ANSI codes"
fi

# tui-capture without -e should NOT have ANSI codes
output_plain=$("$SCRIPT_DIR/tui-capture" "$SESSION" 2>&1)
if [[ "$output_plain" != *$'\033'* ]]; then
    pass "tui-capture without -e strips ANSI codes"
else
    fail "tui-capture should strip ANSI codes by default"
fi

# tui-capture with -S (scrollback)
"$SCRIPT_DIR/tui-send" "$SESSION" "for i in {1..5}; do echo LINE\$i; done"
"$SCRIPT_DIR/tui-send" "$SESSION" --keys "Enter"
sleep 0.3

if output=$("$SCRIPT_DIR/tui-capture" "$SESSION" -S 10 2>&1) && [[ "$output" == *"LINE1"* ]]; then
    pass "tui-capture -S captures scrollback"
else
    fail "tui-capture -S scrollback failed"
fi

# tui-capture with combined flags (-e -S)
if output=$("$SCRIPT_DIR/tui-capture" "$SESSION" -e -S 10 2>&1); then
    pass "tui-capture accepts combined flags (-e -S)"
else
    fail "tui-capture combined flags failed"
fi

# tui-capture -S with invalid value
if ! "$SCRIPT_DIR/tui-capture" "$SESSION" -S 2>/dev/null; then
    pass "tui-capture -S without value fails"
else
    fail "tui-capture -S should require a value"
fi

# =============================================================================
# SESSION LIFECYCLE EDGE CASES
# =============================================================================
echo "Testing session lifecycle..."

# Session with command that exits immediately
"$SCRIPT_DIR/tui-start" "${SESSION}-2" "echo done && exit 0" 2>/dev/null || true
sleep 0.5

# Session may or may not exist (command exited), but tui-stop should handle it
if "$SCRIPT_DIR/tui-stop" "${SESSION}-2" 2>&1; then
    pass "tui-stop handles session with exited command"
else
    fail "tui-stop should handle exited sessions"
fi

# =============================================================================
# TUI-STOP TESTS
# =============================================================================
echo "Testing tui-stop..."

if "$SCRIPT_DIR/tui-stop" "$SESSION" 2>&1; then
    pass "tui-stop completes"
else
    fail "tui-stop failed"
fi

if ! "$SCRIPT_DIR/tmux-isolated" has-session -t "$SESSION" 2>/dev/null; then
    pass "session gone after tui-stop"
else
    fail "session still exists after tui-stop"
fi

# tui-stop is idempotent
if "$SCRIPT_DIR/tui-stop" "$SESSION" 2>&1; then
    pass "tui-stop is idempotent"
else
    fail "tui-stop failed on already-stopped session"
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo

if [[ $FAIL -eq 0 ]]; then
    echo "All tests passed!"
    exit 0
else
    echo "Some tests failed."
    exit 1
fi
