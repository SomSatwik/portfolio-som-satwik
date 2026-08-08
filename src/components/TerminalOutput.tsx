interface TerminalOutputProps {
  command: string;
  output: React.ReactNode;
  promptPath: string;
}

export const TerminalOutput = ({ command, output, promptPath }: TerminalOutputProps) => {
  return (
    <div className="mb-2">
      {/* Only render prompt line if there was an actual command */}
      {command && (
        <div className="flex items-center flex-wrap">
          <span className="terminal-prompt-user text-sm md:text-base">som</span>
          <span className="terminal-prompt-symbol">@</span>
          <span className="terminal-prompt-host">portfolio</span>
          <span className="terminal-prompt-symbol">:</span>
          <span className="terminal-prompt-path">{promptPath}</span>
          <span className="terminal-prompt-symbol">$ </span>
          <span className="text-foreground">{command}</span>
        </div>
      )}

      {/* Command output */}
      {output && <div className="mt-1">{output}</div>}
    </div>
  );
};
