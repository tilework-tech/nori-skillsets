export const generateBashCompletion = (): string => {
  return `#!/usr/bin/env bash
# Bash completion for nori-skillsets
# Add to your .bashrc or .bash_profile:
#   eval "$(nori-skillsets completion bash)"

_nori_skillsets_completions() {
  local cur prev commands global_opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  commands="login logout init search download install switch-skillset list-skillsets download-skill external watch dir fork edit-skillset install-location factory-reset completion help"
  global_opts="--install-dir --non-interactive --silent --agent --experimental-ui --help --version"

  # Complete subcommand at position 1
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  # Complete based on subcommand
  local subcmd="\${COMP_WORDS[1]}"
  case "\${subcmd}" in
    login)
      COMPREPLY=( $(compgen -W "--email --password --google --no-localhost \${global_opts}" -- "\${cur}") )
      ;;
    logout|init|list-skillsets|dir|factory-reset|help)
      COMPREPLY=( $(compgen -W "\${global_opts}" -- "\${cur}") )
      ;;
    fork)
      COMPREPLY=( $(compgen -W "\${global_opts}" -- "\${cur}") )
      ;;
    edit-skillset)
      COMPREPLY=( $(compgen -W "--agent \${global_opts}" -- "\${cur}") )
      ;;
    search)
      COMPREPLY=( $(compgen -W "\${global_opts}" -- "\${cur}") )
      ;;
    download)
      COMPREPLY=( $(compgen -W "--registry --list-versions \${global_opts}" -- "\${cur}") )
      ;;
    install)
      COMPREPLY=( $(compgen -W "--user \${global_opts}" -- "\${cur}") )
      ;;
    switch-skillset)
      if [[ \${COMP_CWORD} -eq 2 ]] && [[ "\${cur}" != -* ]]; then
        local skillsets
        skillsets="$(nori-skillsets list-skillsets 2>/dev/null)"
        COMPREPLY=( $(compgen -W "\${skillsets}" -- "\${cur}") )
      else
        COMPREPLY=( $(compgen -W "--agent \${global_opts}" -- "\${cur}") )
      fi
      ;;
    download-skill)
      COMPREPLY=( $(compgen -W "--registry --list-versions --skillset \${global_opts}" -- "\${cur}") )
      ;;
    external)
      COMPREPLY=( $(compgen -W "--skillset --skill --all --ref \${global_opts}" -- "\${cur}") )
      ;;
    watch)
      if [[ \${COMP_CWORD} -eq 2 ]] && [[ "\${cur}" != -* ]]; then
        COMPREPLY=( $(compgen -W "stop --agent --set-destination \${global_opts}" -- "\${cur}") )
      else
        COMPREPLY=( $(compgen -W "--agent --set-destination \${global_opts}" -- "\${cur}") )
      fi
      ;;
    install-location)
      COMPREPLY=( $(compgen -W "--installation-source --installation-managed \${global_opts}" -- "\${cur}") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh" -- "\${cur}") )
      ;;
  esac

  return 0
}

complete -o default -F _nori_skillsets_completions nori-skillsets nori-skillset sks
`;
};
