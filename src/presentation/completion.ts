const commandWords = [
  "semester department calendar course program lesson classroom exam substitute cache preset doctor completion",
  "list options search show catalog document history module compare download week schedule summary explain available buildings conflicts",
  "--json --csv --ics --offline --no-cache --limit --offset --all --no-color --wide --verbose --usage-type --room-type --from-date --to-date --week-of --bookable --arrangeable --summary --side --download --name --keyword --expand-public --output 替代方 被替代方",
].join(" ");

export const shellCompletion = (shell: string): string => {
  if (shell === "bash") return `# catalog bash completion\n_catalog_complete() {\n  COMPREPLY=( $(compgen -W "${commandWords}" -- "\${COMP_WORDS[COMP_CWORD]}") )\n}\ncomplete -F _catalog_complete catalog\n`;
  if (shell === "zsh") return `#compdef catalog\n_arguments '*:catalog command:(${commandWords})'\n`;
  if (shell === "fish") return `${commandWords.split(" ").map((word) => `complete -c catalog -f -a '${word}'`).join("\n")}\n`;
  if (shell === "powershell") return `Register-ArgumentCompleter -Native -CommandName catalog -ScriptBlock { param($wordToComplete) '${commandWords}'.Split(' ') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) } }\n`;
  throw new Error(`不支持的 shell：${shell}`);
};
