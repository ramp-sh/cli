import { Command, Help } from 'commander';
import { paint } from './ui.js';

class RampHelp extends Help {
    styleTitle(str: string): string {
        return paint(str, ['bold', 'cyan']);
    }

    styleCommandText(str: string): string {
        return paint(str, 'bold');
    }

    styleSubcommandText(str: string): string {
        return paint(str, 'bold');
    }

    styleOptionText(str: string): string {
        return paint(str, 'cyan');
    }

    styleArgumentText(str: string): string {
        return paint(str, 'white');
    }

    styleDescriptionText(str: string): string {
        return paint(str, 'gray');
    }
}

export function configureRampHelp(program: Command): void {
    program.createHelp = () => new RampHelp();
    program.configureHelp({
        sortSubcommands: false,
        sortOptions: false,
    });
    program.addHelpText(
        'after',
        () => `
Examples:
  ramp login
  ramp dashboard
  ramp open
  ramp deploy
  ramp logs --type laravel
`,
    );
}
