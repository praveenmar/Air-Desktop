import * as vscode from 'vscode';

const CHANNEL_NAME = 'AIR Extension';
let channel: vscode.OutputChannel | null = null;

function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  }
  return channel;
}

function fmt(scope: string, message: string, meta?: unknown): string {
  const base = `[${new Date().toISOString()}] [${scope}] ${message}`;
  if (meta === undefined) return base;
  try {
    return `${base} ${JSON.stringify(meta)}`;
  } catch {
    return `${base} ${String(meta)}`;
  }
}

export const airLogger = {
  info(scope: string, message: string, meta?: unknown): void {
    const line = fmt(scope, message, meta);
    getChannel().appendLine(line);
    console.log(line);
  },
  warn(scope: string, message: string, meta?: unknown): void {
    const line = fmt(scope, message, meta);
    getChannel().appendLine(line);
    console.warn(line);
  },
  error(scope: string, message: string, error?: unknown, meta?: unknown): void {
    const errorText = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error;
    const line = fmt(scope, message, { error: errorText, meta });
    getChannel().appendLine(line);
    console.error(line);
  },
  show(): void {
    getChannel().show(true);
  },
};

