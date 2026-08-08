import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn((val) => val === Symbol.for('cancel')),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('configstore', () => {
  const store: Record<string, unknown> = {};
  return {
    default: class MockConfigstore {
      set(key: string, value: unknown): void { store[key] = value; }
      get(key: string): unknown { return store[key]; }
      clear(): void { Object.keys(store).forEach((k) => delete store[k]); }
      delete(key: string): void { delete store[key]; }
    },
  };
});

const clack = await import('@clack/prompts');
const { runInteractiveMenu } = await import('../src/cli/interactive');
const { storage } = await import('../src/utils/storage');

describe('Interactive CLI Mode (TUI)', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.name('bubble-io-cli');
    storage.clearConfig('*');
  });

  it('should display intro banner and exit when exit is selected', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('exit');

    await runInteractiveMenu(program);

    expect(clack.intro).toHaveBeenCalledTimes(1);
    expect(clack.outro).toHaveBeenCalledTimes(1);
    expect(clack.select).toHaveBeenCalledTimes(1);
  });

  it('should display active profile in a note when configured', async () => {
    storage.saveConfig({ appName: 'prod-app', apiKey: 'secret-key' }, 'default');
    vi.mocked(clack.select).mockResolvedValueOnce('exit');

    await runInteractiveMenu(program);

    expect(clack.note).toHaveBeenCalledTimes(1);
    expect(clack.intro).toHaveBeenCalledTimes(1);
  });

  it('should navigate into schema menu and return', async () => {
    // 1. Main menu -> schema
    // 2. Schema menu -> back
    // 3. Main menu loop -> confirm exit
    vi.mocked(clack.select)
      .mockResolvedValueOnce('schema')
      .mockResolvedValueOnce('back');
    vi.mocked(clack.confirm).mockResolvedValueOnce(false);

    storage.saveConfig({ appName: 'prod-app', apiKey: 'secret-key' }, 'default');

    await runInteractiveMenu(program);

    expect(clack.select).toHaveBeenCalledTimes(2);
    expect(clack.outro).toHaveBeenCalledTimes(1);
  });

  it('should handle config sub-menu actions like list profiles', async () => {
    vi.mocked(clack.select)
      .mockResolvedValueOnce('config')
      .mockResolvedValueOnce('list');
    vi.mocked(clack.confirm).mockResolvedValueOnce(false);

    const parseSpy = vi.spyOn(program, 'parseAsync').mockResolvedValue(program);

    await runInteractiveMenu(program);

    expect(parseSpy).toHaveBeenCalledWith(['node', 'bubble-io-cli', 'config', '--list']);
  });

  it('should handle devtools health check command invocation', async () => {
    storage.saveConfig({ appName: 'test-app', apiKey: 'test-key' }, 'default');

    vi.mocked(clack.select)
      .mockResolvedValueOnce('devtools')
      .mockResolvedValueOnce('health')
      .mockResolvedValueOnce('version-test');
    vi.mocked(clack.confirm).mockResolvedValueOnce(false);

    const parseSpy = vi.spyOn(program, 'parseAsync').mockResolvedValue(program);

    await runInteractiveMenu(program);

    expect(parseSpy).toHaveBeenCalledWith(['node', 'bubble-io-cli', 'health', '--env', 'version-test']);
  });

  it('should handle code generation types command invocation', async () => {
    storage.saveConfig({ appName: 'test-app', apiKey: 'test-key' }, 'default');

    vi.mocked(clack.select)
      .mockResolvedValueOnce('generate')
      .mockResolvedValueOnce('types')
      .mockResolvedValueOnce('version-test')
      .mockResolvedValueOnce('file');
    vi.mocked(clack.text)
      .mockResolvedValueOnce('') // type filter
      .mockResolvedValueOnce('./types.d.ts'); // output path
    vi.mocked(clack.confirm).mockResolvedValueOnce(false);

    const parseSpy = vi.spyOn(program, 'parseAsync').mockResolvedValue(program);

    await runInteractiveMenu(program);

    expect(parseSpy).toHaveBeenCalledWith([
      'node',
      'bubble-io-cli',
      'generate',
      'types',
      '--env',
      'version-test',
      '--output',
      './types.d.ts',
    ]);
  });

  it('should handle interactive schema migration generate command', async () => {
    storage.saveConfig({ appName: 'test-app', apiKey: 'test-key' }, 'default');

    vi.mocked(clack.select)
      .mockResolvedValueOnce('schema')
      .mockResolvedValueOnce('migrate_generate')
      .mockResolvedValueOnce('version-test')
      .mockResolvedValueOnce('lockfile');
    vi.mocked(clack.text)
      .mockResolvedValueOnce('add_user_orders') // name
      .mockResolvedValueOnce('Adds orders table and relation') // desc
      .mockResolvedValueOnce('./custom-migrations'); // dir
    vi.mocked(clack.confirm).mockResolvedValueOnce(false);

    const parseSpy = vi.spyOn(program, 'parseAsync').mockResolvedValue(program);

    await runInteractiveMenu(program);

    expect(parseSpy).toHaveBeenCalledWith([
      'node',
      'bubble-io-cli',
      'schema',
      'migrate:generate',
      '--name',
      'add_user_orders',
      '--env',
      'version-test',
      '--dir',
      './custom-migrations',
      '--description',
      'Adds orders table and relation',
    ]);
  });

  it('should handle interactive schema migration list command', async () => {
    storage.saveConfig({ appName: 'test-app', apiKey: 'test-key' }, 'default');

    vi.mocked(clack.select)
      .mockResolvedValueOnce('schema')
      .mockResolvedValueOnce('migrate_list');
    vi.mocked(clack.text)
      .mockResolvedValueOnce('./migrations'); // dir
    vi.mocked(clack.confirm).mockResolvedValueOnce(false);

    const parseSpy = vi.spyOn(program, 'parseAsync').mockResolvedValue(program);

    await runInteractiveMenu(program);

    expect(parseSpy).toHaveBeenCalledWith([
      'node',
      'bubble-io-cli',
      'schema',
      'migrate:list',
      '--dir',
      './migrations',
    ]);
  });

  it('should handle interactive schema baseline snapshot command', async () => {
    storage.saveConfig({ appName: 'test-app', apiKey: 'test-key' }, 'default');

    vi.mocked(clack.select)
      .mockResolvedValueOnce('schema')
      .mockResolvedValueOnce('migrate_snapshot')
      .mockResolvedValueOnce('version-live');
    vi.mocked(clack.text)
      .mockResolvedValueOnce('./migrations'); // dir
    vi.mocked(clack.confirm).mockResolvedValueOnce(false);

    const parseSpy = vi.spyOn(program, 'parseAsync').mockResolvedValue(program);

    await runInteractiveMenu(program);

    expect(parseSpy).toHaveBeenCalledWith([
      'node',
      'bubble-io-cli',
      'schema',
      'migrate:generate',
      '--snapshot-only',
      '--env',
      'version-live',
      '--dir',
      './migrations',
    ]);
  });
});
