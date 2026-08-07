import { Command } from 'commander';
import chalk from 'chalk';

const BASH_COMPLETION = `
# bubble-io-cli bash completion
# Add to ~/.bashrc or ~/.bash_profile:
#   source <(bubble-io-cli completions --bash)

_bubble_io_cli_completions() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
  }

  local commands="config backup restore diff generate completions"

  case "\${COMP_WORDS[1]}" in
    config)
      local opts="--app --key --profile --show --list --use --clear --all"
      COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
      return 0
      ;;
    backup)
      local opts="--type --env --output --limit --format --constraint --since --watch --interval --destination --encrypt --json"
      case "\${prev}" in
        --env)   COMPREPLY=( \$(compgen -W "version-test version-live" -- "\${cur}") ); return 0 ;;
        --format) COMPREPLY=( \$(compgen -W "json csv" -- "\${cur}") ); return 0 ;;
        --output|--destination) COMPREPLY=( \$(compgen -d -- "\${cur}") ); return 0 ;;
      esac
      COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
      return 0
      ;;
    restore)
      local opts="--file --env --type --mode --concurrency --dry-run"
      case "\${prev}" in
        --env)  COMPREPLY=( \$(compgen -W "version-test version-live" -- "\${cur}") ); return 0 ;;
        --mode) COMPREPLY=( \$(compgen -W "create upsert" -- "\${cur}") ); return 0 ;;
        --file) COMPREPLY=( \$(compgen -f -X '!*.json' -- "\${cur}") ); return 0 ;;
      esac
      COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
      return 0
      ;;
    diff)
      local opts="--file --type --env --fields --summary"
      case "\${prev}" in
        --env)  COMPREPLY=( \$(compgen -W "version-test version-live" -- "\${cur}") ); return 0 ;;
        --file) COMPREPLY=( \$(compgen -f -X '!*.json' -- "\${cur}") ); return 0 ;;
      esac
      COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
      return 0
      ;;
    generate|g)
      local opts="--template --name --output --list"
      case "\${prev}" in
        --template) COMPREPLY=( \$(compgen -W "plugin-action api-connector data-trigger" -- "\${cur}") ); return 0 ;;
      esac
      COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
      return 0
      ;;
    completions)
      COMPREPLY=( \$(compgen -W "--bash --zsh --fish" -- "\${cur}") )
      return 0
      ;;
    *)
      COMPREPLY=( \$(compgen -W "\${commands}" -- "\${cur}") )
      return 0
      ;;
  esac
}

complete -F _bubble_io_cli_completions bubble-io-cli
`.trim();

const ZSH_COMPLETION = `
# bubble-io-cli zsh completion
# Add to ~/.zshrc:
#   source <(bubble-io-cli completions --zsh)

#compdef bubble-io-cli

_bubble_io_cli() {
  local state

  _arguments -C \\
    '1: :->command' \\
    '*:: :->args'

  case \$state in
    command)
      local commands=(
        'config:Set and manage Bubble.io API credentials'
        'backup:Download and export records from a Bubble data type'
        'restore:Upload records from a backup file back to Bubble'
        'diff:Compare live data against a local backup'
        'generate:Scaffold integration templates'
        'completions:Output shell completion scripts'
      )
      _describe 'command' commands
      ;;
    args)
      case \$words[1] in
        config)
          _arguments \\
            '(-a --app)'{-a,--app}'[App subdomain]:app name' \\
            '(-k --key)'{-k,--key}'[API key]:api key' \\
            '(-p --profile)'{-p,--profile}'[Profile name]:profile' \\
            '--show[Show current config]' \\
            '--list[List all profiles]' \\
            '--use[Switch active profile]:profile' \\
            '--clear[Clear config]' \\
            '--all[Clear all profiles]'
          ;;
        backup)
          _arguments \\
            '(-t --type)'{-t,--type}'[Data type]:type' \\
            '(-e --env)'{-e,--env}'[Environment]:(version-test version-live)' \\
            '(-o --output)'{-o,--output}'[Output dir]:dir:_directories' \\
            '(-l --limit)'{-l,--limit}'[Max records]:number' \\
            '(-f --format)'{-f,--format}'[Format]:(json csv)' \\
            '(-c --constraint)'{-c,--constraint}'[Constraints JSON]:json' \\
            '--since[Since date]:date' \\
            '--watch[Watch mode]' \\
            '--interval[Interval seconds]:seconds' \\
            '--destination[Cloud destination]:url' \\
            '--encrypt[Encrypt output]' \\
            '--json[JSON output mode]'
          ;;
        restore)
          _arguments \\
            '(-f --file)'{-f,--file}'[Backup file]:file:_files -g "*.json"' \\
            '(-e --env)'{-e,--env}'[Environment]:(version-test version-live)' \\
            '(-t --type)'{-t,--type}'[Override data type]:type' \\
            '(-m --mode)'{-m,--mode}'[Restore mode]:(create upsert)' \\
            '--concurrency[Parallel requests]:number' \\
            '--dry-run[Dry run]'
          ;;
        diff)
          _arguments \\
            '(-f --file)'{-f,--file}'[Backup file]:file:_files -g "*.json"' \\
            '(-t --type)'{-t,--type}'[Override data type]:type' \\
            '(-e --env)'{-e,--env}'[Environment]:(version-test version-live)' \\
            '--fields[Fields to compare]:fields' \\
            '--summary[Show summary only]'
          ;;
        generate|g)
          _arguments \\
            '(-t --template)'{-t,--template}'[Template]:(plugin-action api-connector data-trigger)' \\
            '(-n --name)'{-n,--name}'[Name]:name' \\
            '(-o --output)'{-o,--output}'[Output dir]:dir:_directories' \\
            '--list[List templates]'
          ;;
      esac
      ;;
  esac
}

_bubble_io_cli
`.trim();

const FISH_COMPLETION = `
# bubble-io-cli fish completion
# Save to ~/.config/fish/completions/bubble-io-cli.fish
# Or run: bubble-io-cli completions --fish > ~/.config/fish/completions/bubble-io-cli.fish

set -l commands config backup restore diff generate completions

complete -c bubble-io-cli -f -n "not __fish_seen_subcommand_from $commands" -a config -d 'Manage credentials'
complete -c bubble-io-cli -f -n "not __fish_seen_subcommand_from $commands" -a backup -d 'Export data to file'
complete -c bubble-io-cli -f -n "not __fish_seen_subcommand_from $commands" -a restore -d 'Upload backup to Bubble'
complete -c bubble-io-cli -f -n "not __fish_seen_subcommand_from $commands" -a diff -d 'Compare data with backup'
complete -c bubble-io-cli -f -n "not __fish_seen_subcommand_from $commands" -a generate -d 'Scaffold templates'
complete -c bubble-io-cli -f -n "not __fish_seen_subcommand_from $commands" -a completions -d 'Shell completions'

# backup options
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l type -s t -d 'Data type'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l env -s e -d 'Environment' -a "version-test version-live"
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l format -s f -d 'Output format' -a "json csv"
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l limit -s l -d 'Max records'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l output -s o -d 'Output dir'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l since -d 'Since date'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l watch -d 'Watch mode'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l interval -d 'Interval seconds'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l destination -d 'Cloud destination'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l encrypt -d 'Encrypt output'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from backup" -l json -d 'JSON output'

# restore options
complete -c bubble-io-cli -n "__fish_seen_subcommand_from restore" -l file -s f -d 'Backup JSON file'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from restore" -l env -s e -d 'Environment' -a "version-test version-live"
complete -c bubble-io-cli -n "__fish_seen_subcommand_from restore" -l mode -s m -d 'Restore mode' -a "create upsert"
complete -c bubble-io-cli -n "__fish_seen_subcommand_from restore" -l dry-run -d 'Dry run'

# config options
complete -c bubble-io-cli -n "__fish_seen_subcommand_from config" -l app -s a -d 'App subdomain'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from config" -l key -s k -d 'API key'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from config" -l profile -s p -d 'Profile name'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from config" -l show -d 'Show config'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from config" -l list -d 'List profiles'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from config" -l use -d 'Switch profile'
complete -c bubble-io-cli -n "__fish_seen_subcommand_from config" -l clear -d 'Clear config'
`.trim();

/**
 * Registers the `completions` sub-command.
 * Outputs shell completion scripts that can be sourced in the user's shell config.
 *
 * Usage:
 *   bubble-io-cli completions --bash
 *   bubble-io-cli completions --zsh
 *   bubble-io-cli completions --fish > ~/.config/fish/completions/bubble-io-cli.fish
 *   source <(bubble-io-cli completions --bash)
 */
export function registerCompletionsCommand(program: Command): void {
  program
    .command('completions')
    .description('Output shell completion scripts for Bash, Zsh, or Fish')
    .option('--bash', 'Output Bash completion script')
    .option('--zsh', 'Output Zsh completion script')
    .option('--fish', 'Output Fish completion script')
    .action((options: { bash?: boolean; zsh?: boolean; fish?: boolean }) => {
      if (options.bash) {
        console.log(BASH_COMPLETION);
        return;
      }
      if (options.zsh) {
        console.log(ZSH_COMPLETION);
        return;
      }
      if (options.fish) {
        console.log(FISH_COMPLETION);
        return;
      }

      // No flag provided — show install instructions
      console.log(chalk.cyan('\n🐚 Shell Completion Setup\n'));
      console.log(chalk.bold('Bash:'));
      console.log(chalk.dim('  Add to ~/.bashrc or ~/.bash_profile:'));
      console.log('  source <(bubble-io-cli completions --bash)\n');
      console.log(chalk.bold('Zsh:'));
      console.log(chalk.dim('  Add to ~/.zshrc:'));
      console.log('  source <(bubble-io-cli completions --zsh)\n');
      console.log(chalk.bold('Fish:'));
      console.log(chalk.dim('  Run once:'));
      console.log('  bubble-io-cli completions --fish > ~/.config/fish/completions/bubble-io-cli.fish\n');
    });
}
