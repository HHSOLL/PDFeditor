export type FeatureCommand = {
  id: string;
  label: string;
  implemented: boolean;
  enabled: () => boolean;
  disabledReason?: () => string;
  run?: () => void | Promise<void>;
};

const featureCommands = new Map<string, FeatureCommand>();
let onDisabledCommand = (message: string) => {
  window.alert(message);
};

export function configureFeatureCommands(options: { onDisabledCommand?: (message: string) => void }) {
  if (options.onDisabledCommand) {
    onDisabledCommand = options.onDisabledCommand;
  }
}

export function registerCommand(command: FeatureCommand) {
  featureCommands.set(command.id, command);
}

export function getFeatureCommand(id: string) {
  return featureCommands.get(id);
}

export function bindCommandButton(button: HTMLButtonElement, command: FeatureCommand) {
  button.dataset.commandId = command.id;
  button.addEventListener("click", () => {
    executeCommand(command.id).catch((error) => {
      console.error(error);
      onDisabledCommand(error instanceof Error ? error.message : "명령 실행에 실패했습니다.");
    });
  });
  syncCommandButton(button, command);
}

export function syncCommandButton(button: HTMLButtonElement, command: FeatureCommand) {
  if (!command.implemented) {
    button.hidden = true;
    button.disabled = true;
    button.title = "아직 구현되지 않은 기능입니다.";
    return;
  }
  button.hidden = false;
  const enabled = command.enabled();
  button.disabled = !enabled;
  button.title = enabled ? command.label : command.disabledReason?.() ?? "현재 사용할 수 없습니다.";
}

export function syncCommandButtons(root: ParentNode = document) {
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-command-id]"))) {
    const command = featureCommands.get(button.dataset.commandId ?? "");
    if (command) {
      syncCommandButton(button, command);
    }
  }
}

export async function executeCommand(id: string) {
  const command = featureCommands.get(id);
  if (!command) {
    throw new Error(`Unknown command: ${id}`);
  }
  if (!command.implemented) {
    onDisabledCommand("아직 구현되지 않은 기능입니다.");
    return;
  }
  if (!command.enabled()) {
    onDisabledCommand(command.disabledReason?.() ?? "현재 사용할 수 없는 기능입니다.");
    return;
  }
  await command.run?.();
}
