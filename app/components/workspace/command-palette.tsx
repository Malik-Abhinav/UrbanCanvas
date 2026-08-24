"use client";

import { useEffect, useRef, useState } from "react";
import { Command } from "lucide-react";
import { filterCommands, type PaletteCommand } from "../../drawing-precision";

type CommandPaletteProps = {
  commands: readonly PaletteCommand[];
  onClose: () => void;
  onRun: (id: string) => void;
  open: boolean;
};

/**
 * Keyboard-first command palette (⌘K / Ctrl+K). Graphite surface, warm
 * off-white text and the #f5c542 accent used across the canvas chrome.
 */
export default function CommandPalette({ commands, onClose, onRun, open }: CommandPaletteProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const results = filterCommands(commands, query);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);

      // Focus after mount so the panel is visible before the caret lands.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function run(command: PaletteCommand) {
    onRun(command.id);
    onClose();
  }

  return (
    <div
      aria-label="Command palette"
      className="absolute left-1/2 top-14 z-40 w-80 -translate-x-1/2 rounded border border-white/20 bg-[#101311]/95 shadow-2xl backdrop-blur"
      role="dialog"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Command className="shrink-0 text-[#f5c542]" size={14} />
        <input
          aria-label="Search commands"
          className="w-full bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onClose();
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(results.length - 1, index + 1));
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();

              const command = results[activeIndex];

              if (command) {
                run(command);
              }
            }
          }}
          placeholder="Type a command…"
          ref={inputRef}
          type="text"
          value={query}
        />
      </div>
      <ul aria-label="Matching commands" className="max-h-64 overflow-y-auto p-1" role="listbox">
        {results.length === 0 ? (
          <li className="px-3 py-2 text-xs text-white/45">No matching commands.</li>
        ) : (
          results.map((command, index) => (
            <li key={command.id}>
              <button
                aria-selected={index === activeIndex}
                className={`flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-sm transition ${
                  index === activeIndex ? "bg-[#f5c542]/15 text-white" : "text-white/75 hover:bg-white/5"
                }`}
                onClick={() => run(command)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <span>{command.title}</span>
                {command.hint ? <kbd className="text-[10px] uppercase text-white/40">{command.hint}</kbd> : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
