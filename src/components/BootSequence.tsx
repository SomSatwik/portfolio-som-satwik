import { useState, useEffect } from 'react';

interface BootSequenceProps {
  onBootComplete: () => void;
}

const ASCII_ART = `
███████╗ ██████╗ ███╗   ███╗    ███████╗ █████╗ ████████╗██╗    ██╗██╗██╗  ██╗
██╔════╝██╔═══██╗████╗ ████║    ██╔════╝██╔══██╗╚══██╔══╝██║    ██║██║██║ ██╔╝
███████╗██║   ██║██╔████╔██║    ███████╗███████║   ██║   ██║ █╗ ██║██║█████╔╝
╚════██║██║   ██║██║╚██╔╝██║    ╚════██║██╔══██║   ██║   ██║███╗██║██║██╔═██╗
███████║╚██████╔╝██║ ╚═╝ ██║    ███████║██║  ██║   ██║   ╚███╔███╔╝██║██║  ██╗
╚══════╝ ╚═════╝ ╚═╝     ╚═╝    ╚══════╝╚═╝  ╚═╝   ╚═╝    ╚══╝╚══╝ ╚═╝╚═╝  ╚═╝

`;

const BOOT_MESSAGES = [
  'Initializing terminal...',
  'Loading user profile...',
  'Mounting portfolio filesystem...',
  'Starting shell session...',
  'Connecting to portfolio server...',
  'Loading project database...',
  'Initializing command interface...',
  'Ready.',
];

export const BootSequence = ({ onBootComplete }: BootSequenceProps) => {
  const [currentMessage, setCurrentMessage] = useState(0);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentMessage(prev => {
        if (prev < BOOT_MESSAGES.length - 1) {
          return prev + 1;
        } else {
          clearInterval(timer);
          setShowWelcome(true);
          setTimeout(() => {
            onBootComplete();
          }, 2000);
          return prev;
        }
      });
    }, 300);

    return () => clearInterval(timer);
  }, [onBootComplete]);

  return (
    <div className="h-screen bg-background text-foreground font-mono flex flex-col justify-center items-center p-4">
      <div className="max-w-4xl w-full">
        {!showWelcome ? (
          // Boot messages
          <div className="space-y-2">
            {BOOT_MESSAGES.slice(0, currentMessage + 1).map((message, index) => (
              <div key={index} className="flex items-center">
                <span className="terminal-success mr-2">✓</span>
                <span className={index === currentMessage ? 'type-animation' : ''}>
                  {message}
                </span>
              </div>
            ))}
            <div className="flex items-center mt-4">
              <span className="terminal-cursor"></span>
            </div>
          </div>
        ) : (
          // Welcome screen
          <div className="boot-animation text-center">
            <pre className="terminal-success text-xs md:text-sm mb-6 overflow-x-auto">
              {ASCII_ART}
            </pre>
            
            <div className="text-lg md:text-xl mb-4">
              Welcome to <span className="terminal-warning">Som Satwik Deo's</span> Portfolio Terminal
            </div>
            
            <div className="text-sm md:text-base mb-6 terminal-gray">
              <div>CSE Student • India • Open Source Developer</div>
              <div>Software • Real-time Systems • Cybersecurity • AI/Agents • Emergent Systems</div>
            </div>
            
            <div className="text-sm terminal-info">
              Type <span className="terminal-warning">'help'</span> to get started
            </div>
            
            <div className="mt-8 text-xs terminal-gray">
              Portfolio v2.0.1 - Built with React & TypeScript
            </div>
          </div>
        )}
      </div>
    </div>
  );
};