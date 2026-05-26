import { describe, it, expect } from 'vitest';
import { executeShellStage } from '../../src/stages/shell.js';
import { createContext } from '../../src/context.js';
function stage(overrides) {
    return {
        id: 'test-shell',
        type: 'shell',
        command: 'echo hello',
        ...overrides,
    };
}
const ctx = createContext('input text', { myVar: 'VAR' });
// ── basic execution ───────────────────────────────────────────────────────────
describe('executeShellStage', () => {
    it('executes a command and returns stdout', async () => {
        const result = await executeShellStage(stage({ command: 'echo hello' }), ctx, 'input');
        expect(result.trim()).toBe('hello');
    });
    it('interpolates {{input}} in the command', async () => {
        const result = await executeShellStage(stage({ command: 'echo {{input}}' }), ctx, 'myinput');
        expect(result.trim()).toBe('myinput');
    });
    it('interpolates {{vars.KEY}} in the command', async () => {
        const result = await executeShellStage(stage({ command: 'echo {{vars.myVar}}' }), ctx, 'unused');
        expect(result.trim()).toBe('VAR');
    });
    it('supports multi-word commands', async () => {
        const result = await executeShellStage(stage({ command: 'echo foo bar baz' }), ctx, 'unused');
        expect(result.trim()).toBe('foo bar baz');
    });
    it('captures output from shell pipelines', async () => {
        const result = await executeShellStage(stage({ command: 'echo -e "line1\nline2\nline3" | grep line2' }), ctx, 'unused');
        expect(result.trim()).toBe('line2');
    });
    it('throws when the command exits non-zero (no interactive flag)', async () => {
        await expect(executeShellStage(stage({ command: 'exit 1' }), ctx, 'unused')).rejects.toThrow(/Shell command failed/);
    });
    it('includes exit code in the error message', async () => {
        await expect(executeShellStage(stage({ command: 'exit 42' }), ctx, 'unused')).rejects.toThrow(/exit 42/);
    });
    it('respects the workdir option', async () => {
        const result = await executeShellStage(stage({ command: 'pwd', workdir: '/tmp' }), ctx, 'unused');
        // /tmp on macOS can be a symlink to /private/tmp
        expect(result.trim()).toMatch(/\/tmp$/);
    });
    it('passes environment variables from ctx.env to the child process', async () => {
        const localCtx = createContext('test');
        localCtx.env['AIAC_SHELL_TEST'] = 'shell_env_value';
        const result = await executeShellStage(stage({ command: 'echo $AIAC_SHELL_TEST' }), localCtx, 'unused');
        expect(result.trim()).toBe('shell_env_value');
    });
});
// ── interactive flag ──────────────────────────────────────────────────────────
describe('executeShellStage — interactive: true', () => {
    it('runs a quick interactive process and resolves with "interactive session completed"', async () => {
        // Use a real command that immediately exits: `true` (exit 0)
        const result = await executeShellStage(stage({ command: 'true', interactive: true }), ctx, 'unused');
        expect(result).toBe('interactive session completed');
    });
    it('still resolves (does not reject) when the interactive process exits non-zero', async () => {
        // Non-zero exit should warn but not throw
        await expect(executeShellStage(stage({ command: 'false', interactive: true }), ctx, 'unused')).resolves.toBe('interactive session completed');
    });
});
//# sourceMappingURL=shell.test.js.map