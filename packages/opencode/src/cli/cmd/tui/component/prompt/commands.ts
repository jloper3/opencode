/**
 * Local TUI commands - resolved entirely in the TUI layer without LLM calls
 * Commands use the `:` prefix (e.g., `:clear`, `:copy`, `:theme`)
 */

import type { Accessor, Setter } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import type { SDK } from "~/cli/cmd/tui/util/sdk";
import type { SyncContext } from "~/cli/cmd/tui/util/sync";
import type { LocalContext } from "~/cli/cmd/tui/util/local";
import type { ThemeContext } from "~/cli/cmd/tui/util/theme";
import type { DialogContext } from "~/cli/cmd/tui/util/dialog";
import type { ToastContext } from "~/cli/cmd/tui/util/toast";
import type { RouteContext } from "~/cli/cmd/tui/util/route";
import { readClipboard, writeClipboard } from "~/cli/cmd/tui/util/clipboard";

/** Prefix for local-only commands */
export const LOCAL_COMMAND_PREFIX = ":";

/** Prompt state shape from prompt component */
export interface PromptInfo {
  input: string;
  parts: Array<{
    file?: { path: string; line_range?: [number, number] };
    agent?: { name: string };
    paste?: { text: string; mimeType?: string };
  }>;
}

/** Store shape from prompt component */
export interface PromptStore {
  prompt: PromptInfo;
  mode: "normal" | "shell";
  extmarkToPartIndex: Map<number, number>;
  interrupt: number;
  placeholder: number;
}

/** Context passed to command handlers */
export interface CommandContext {
  /** Current input text */
  input: string;
  /** Arguments array (split by whitespace) */
  args: string[];
  /** UI store getter */
  store: Accessor<PromptStore>;
  /** UI store setter */
  setStore: SetStoreFunction<PromptStore>;
  /** OpenCode SDK client */
  sdk: SDK;
  /** Sync context (global state) */
  sync: SyncContext;
  /** Local context (agent/model selection) */
  local: LocalContext;
  /** Theme context */
  theme: ThemeContext;
  /** Dialog context */
  dialog: DialogContext;
  /** Toast context */
  toast: ToastContext;
  /** Route context */
  route: RouteContext;
  /** Prompt history accessor */
  history: Accessor<string[]>;
  /** Input extmarks API */
  extmarks: {
    clear: () => void;
  };
}

/** Result of command execution */
export interface CommandResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Optional message to display */
  message?: string;
  /** Whether to prevent normal prompt submission */
  preventDefault?: boolean;
}

/** Command handler function */
export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult> | CommandResult;

/** Command definition */
export interface LocalCommand {
  /** Command name (without prefix) */
  name: string;
  /** Short description */
  description: string;
  /** Usage example */
  usage: string;
  /** Handler function */
  handler: CommandHandler;
  /** Argument count (for validation) */
  minArgs?: number;
  maxArgs?: number;
}

/**
 * Registry of local commands
 */
export const LOCAL_COMMANDS: Record<string, LocalCommand> = {
  clear: {
    name: "clear",
    description: "Clear the prompt input and attached files/agents",
    usage: ":clear",
    handler: async (ctx) => {
      // Clear input text
      ctx.setStore("prompt", "input", "");

      // Clear attached parts
      ctx.setStore("prompt", "parts", []);

      // Clear extmarks
      ctx.extmarks.clear();

      return {
        success: true,
        message: "Prompt cleared",
        preventDefault: true,
      };
    },
  },

  copy: {
    name: "copy",
    description: "Copy text to clipboard",
    usage: ":copy <text>",
    minArgs: 1,
    handler: async (ctx) => {
      const text = ctx.args.join(" ");

      try {
        await writeClipboard(text);
        return {
          success: true,
          message: `Copied to clipboard: ${text.slice(0, 50)}${text.length > 50 ? "..." : ""}`,
          preventDefault: true,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to copy to clipboard: ${error}`,
          preventDefault: true,
        };
      }
    },
  },

  paste: {
    name: "paste",
    description: "Show clipboard contents",
    usage: ":paste",
    handler: async (ctx) => {
      try {
        const content = await readClipboard();

        if (!content) {
          return {
            success: false,
            message: "Clipboard is empty",
            preventDefault: true,
          };
        }

        ctx.toast.show({
          title: "Clipboard Contents",
          description: content.text.slice(0, 200) + (content.text.length > 200 ? "..." : ""),
        });

        return {
          success: true,
          preventDefault: true,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to read clipboard: ${error}`,
          preventDefault: true,
        };
      }
    },
  },

  theme: {
    name: "theme",
    description: "Switch theme (light/dark)",
    usage: ":theme <light|dark>",
    minArgs: 1,
    maxArgs: 1,
    handler: async (ctx) => {
      const theme = ctx.args[0]?.toLowerCase();

      if (theme !== "light" && theme !== "dark") {
        return {
          success: false,
          message: "Invalid theme. Use 'light' or 'dark'",
          preventDefault: true,
        };
      }

      // Theme switching is handled by the theme context via config
      // We'll just show a message since theme state is managed externally
      ctx.toast.show({
        title: "Theme",
        description: `Switch to ${theme} theme in settings`,
      });

      return {
        success: true,
        message: `To switch theme, update your OpenCode config`,
        preventDefault: true,
      };
    },
  },

  shell: {
    name: "shell",
    description: "Toggle persistent shell mode",
    usage: ":shell",
    handler: async (ctx) => {
      const currentMode = ctx.store().mode;
      const newMode = currentMode === "shell" ? "normal" : "shell";

      ctx.setStore("mode", newMode);

      return {
        success: true,
        message: `Shell mode ${newMode === "shell" ? "enabled" : "disabled"}`,
        preventDefault: true,
      };
    },
  },

  history: {
    name: "history",
    description: "Show recent prompt history",
    usage: ":history [count]",
    maxArgs: 1,
    handler: async (ctx) => {
      const historyList = ctx.history();
      const count = ctx.args[0] ? parseInt(ctx.args[0], 10) : 10;

      if (isNaN(count) || count <= 0) {
        return {
          success: false,
          message: "Invalid count. Must be a positive number",
          preventDefault: true,
        };
      }

      const recent = historyList.slice(-count).reverse();

      if (recent.length === 0) {
        return {
          success: false,
          message: "No history available",
          preventDefault: true,
        };
      }

      // Show in dialog
      const historyText = recent
        .map((item, i) => `${recent.length - i}. ${item.slice(0, 100)}${item.length > 100 ? "..." : ""}`)
        .join("\n");

      ctx.toast.show({
        title: `Recent History (${recent.length} items)`,
        description: historyText,
      });

      return {
        success: true,
        preventDefault: true,
      };
    },
  },

  mode: {
    name: "mode",
    description: "Show or set current mode (normal/shell)",
    usage: ":mode [normal|shell]",
    maxArgs: 1,
    handler: async (ctx) => {
      if (ctx.args.length === 0) {
        // Show current mode
        const currentMode = ctx.store().mode;
        return {
          success: true,
          message: `Current mode: ${currentMode}`,
          preventDefault: true,
        };
      }

      const mode = ctx.args[0]?.toLowerCase();

      if (mode !== "normal" && mode !== "shell") {
        return {
          success: false,
          message: "Invalid mode. Use 'normal' or 'shell'",
          preventDefault: true,
        };
      }

      ctx.setStore("mode", mode);

      return {
        success: true,
        message: `Mode set to ${mode}`,
        preventDefault: true,
      };
    },
  },

  help: {
    name: "help",
    description: "Show available local commands",
    usage: ":help",
    handler: async (ctx) => {
      const commands = Object.values(LOCAL_COMMANDS)
        .map((cmd) => `${cmd.usage.padEnd(30)} ${cmd.description}`)
        .join("\n");

      ctx.toast.show({
        title: "Local Commands",
        description: `Available commands:\n\n${commands}`,
      });

      return {
        success: true,
        preventDefault: true,
      };
    },
  },

  interrupt: {
    name: "interrupt",
    description: "Interrupt the current session",
    usage: ":interrupt",
    handler: async (ctx) => {
      try {
        await ctx.sdk.client.session.interrupt({ sessionID: ctx.route.sessionID });

        return {
          success: true,
          message: "Session interrupted",
          preventDefault: true,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to interrupt session: ${error}`,
          preventDefault: true,
        };
      }
    },
  },
};

/**
 * Parse input text to extract command name and arguments
 */
export function parseLocalCommand(input: string): {
  isLocalCommand: boolean;
  command?: string;
  args?: string[];
} {
  if (!input.startsWith(LOCAL_COMMAND_PREFIX)) {
    return { isLocalCommand: false };
  }

  const withoutPrefix = input.slice(LOCAL_COMMAND_PREFIX.length);
  const parts = withoutPrefix.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);

  return {
    isLocalCommand: true,
    command,
    args,
  };
}

/**
 * Execute a local command
 */
export async function executeLocalCommand(
  input: string,
  ctx: CommandContext
): Promise<CommandResult> {
  const parsed = parseLocalCommand(input);

  if (!parsed.isLocalCommand || !parsed.command) {
    return {
      success: false,
      message: "Not a local command",
      preventDefault: false,
    };
  }

  const commandDef = LOCAL_COMMANDS[parsed.command];

  if (!commandDef) {
    return {
      success: false,
      message: `Unknown local command: ${parsed.command}. Type :help for available commands.`,
      preventDefault: true,
    };
  }

  // Validate argument count
  const argCount = parsed.args?.length ?? 0;

  if (commandDef.minArgs !== undefined && argCount < commandDef.minArgs) {
    return {
      success: false,
      message: `Too few arguments. Usage: ${commandDef.usage}`,
      preventDefault: true,
    };
  }

  if (commandDef.maxArgs !== undefined && argCount > commandDef.maxArgs) {
    return {
      success: false,
      message: `Too many arguments. Usage: ${commandDef.usage}`,
      preventDefault: true,
    };
  }

  // Execute handler
  try {
    const result = await commandDef.handler({
      ...ctx,
      input,
      args: parsed.args ?? [],
    });

    return result;
  } catch (error) {
    return {
      success: false,
      message: `Command error: ${error}`,
      preventDefault: true,
    };
  }
}

/**
 * Get list of all local commands for autocomplete
 */
export function getLocalCommandList(): Array<{
  name: string;
  description: string;
  usage: string;
}> {
  return Object.values(LOCAL_COMMANDS).map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    usage: cmd.usage,
  }));
}
