export const generateZshCompletion = (): string => {
  return `#compdef nori-skillsets nori-skillset sks
# Zsh completion for nori-skillsets
# Add to your .zshrc:
#   eval "$(nori-skillsets completion zsh)"

_nori_skillsets() {
  local -a commands
  local -a global_opts

  global_opts=(
    '(-d --install-dir)'{-d,--install-dir}'[Custom installation directory]:path:_files -/'
    '(-n --non-interactive)'{-n,--non-interactive}'[Run without interactive prompts]'
    '(-s --silent)'{-s,--silent}'[Suppress all output]'
    '(-a --agent)'{-a,--agent}'[AI agent to use]:name:'
    '(-h --help)'{-h,--help}'[Display help]'
    '(-V --version)'{-V,--version}'[Output version]'
  )

  commands=(
    'login:Authenticate with noriskillsets.dev'
    'logout:Clear stored authentication credentials'
    'init:Initialize Nori configuration and directories'
    'search:Search for skillsets and skills in registry'
    'download:Download and install a skillset package'
    'install:Download, install, and activate a skillset'
    'switch:Switch to a different skillset and reinstall'
    'list:List locally available skillsets'
    'download-skill:Download and install a skill package'
    'external:Install skills from an external GitHub repository'
    'watch:Watch Claude Code sessions and save transcripts'
    'dir:Open the Nori profiles directory'
    'fork:Fork an existing skillset to a new name'
    'edit:Open a skillset folder in VS Code'
    'install-location:Display Nori installation directories'
    'factory-reset:Remove all configuration for a given agent'
    'completion:Generate shell completion script'
    'help:Display help for a command'
  )

  _arguments -C \\
    \$global_opts \\
    '1: :->command' \\
    '*:: :->args'

  case \$state in
    command)
      _describe 'command' commands
      ;;
    args)
      case \$words[1] in
        login)
          _arguments \\
            '(-e --email)'{-e,--email}'[Email address]:email:' \\
            '(-p --password)'{-p,--password}'[Password]:password:' \\
            '(-g --google)'{-g,--google}'[Sign in with Google SSO]' \\
            '--no-localhost[Use hosted callback page]' \\
            \$global_opts
          ;;
        logout|init|list|dir|factory-reset|help)
          _arguments \$global_opts
          ;;
        fork-skillset)
          _arguments \\
            '1:base-skillset:' \\
            '2:new-skillset:' \\
            \$global_opts
          ;;
        edit)
          _arguments \\
            '1:name:' \\
            '(-a --agent)'{-a,--agent}'[AI agent to get skillset for]:name:' \\
            \$global_opts
          ;;
        search)
          _arguments \\
            '1:query:' \\
            \$global_opts
          ;;
        download)
          _arguments \\
            '1:package:' \\
            '--registry[Registry URL]:url:' \\
            '--list-versions[List available versions]' \\
            \$global_opts
          ;;
        install)
          _arguments \\
            '1:package:' \\
            '--user[Install to user home directory]' \\
            \$global_opts
          ;;
        switch)
          _arguments \\
            '1:name:->skillset_name' \\
            '(-a --agent)'{-a,--agent}'[AI agent to switch skillset for]:name:' \\
            \$global_opts
          if [[ \$state == skillset_name ]]; then
            local -a skillsets
            skillsets=(\${(f)"$(nori-skillsets list 2>/dev/null)"})
            compadd -a skillsets
          fi
          ;;
        download-skill)
          _arguments \\
            '1:skill:' \\
            '--registry[Registry URL]:url:' \\
            '--list-versions[List available versions]' \\
            '--skillset[Add skill to specified skillset]:name:' \\
            \$global_opts
          ;;
        external)
          _arguments \\
            '1:source:' \\
            '--skillset[Add skill to specified skillset]:name:' \\
            '--skill[Install only named skill]:name:' \\
            '--all[Install all discovered skills]' \\
            '--ref[Branch or tag to checkout]:ref:' \\
            \$global_opts
          ;;
        watch)
          local -a watch_commands
          watch_commands=(
            'stop:Stop the watch daemon'
          )
          _arguments \\
            '1: :->watch_subcmd' \\
            '(-a --agent)'{-a,--agent}'[Agent to watch]:name:' \\
            '--set-destination[Re-configure transcript upload destination]' \\
            \$global_opts
          if [[ \$state == watch_subcmd ]]; then
            _describe 'watch command' watch_commands
          fi
          ;;
        install-location)
          _arguments \\
            '--installation-source[Show only installation source directories]' \\
            '--installation-managed[Show only managed installation directories]' \\
            \$global_opts
          ;;
        completion)
          _arguments '1:shell:(bash zsh)'
          ;;
      esac
      ;;
  esac
}

compdef _nori_skillsets nori-skillsets nori-skillset sks
`;
};
