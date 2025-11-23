// src/scripts/script-loader.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ScriptLifecycle } from './types';

interface ScriptConfig {
  id: string;
  file: string;
  enabled?: boolean;
  dependsOn?: string[];
}

interface ScriptIndexFile {
  scripts: ScriptConfig[];
}

@Injectable()
export class ScriptLoaderService {
  private readonly logger = new Logger(ScriptLoaderService.name);

  // корень берём как cwd backend’а
  private scriptRoot = path.resolve(process.cwd(), 'script');
  private coreDir = path.join(this.scriptRoot, 'core');
  private userDir = path.join(this.scriptRoot, 'user');

  async loadAllScripts(): Promise<ScriptLifecycle[]> {
    const core = await this.loadFromDir(this.coreDir, 'core');
    const user = await this.loadFromDir(this.userDir, 'user');

    const all = [...core, ...user];

    const seen = new Set<string>();
    for (const s of all) {
      if (seen.has(s.id)) {
        throw new Error(`Duplicate script id: ${s.id}`);
      }
      seen.add(s.id);
    }

    this.logger.log(
      `Loaded ${core.length} core scripts and ${user.length} user scripts`,
    );

    return all;
  }

  private async loadFromDir(
    dir: string,
    kind: 'core' | 'user',
  ): Promise<ScriptLifecycle[]> {
    const indexPath = path.join(dir, 'index.json');

    let raw: string;
    try {
      raw = await fs.readFile(indexPath, 'utf8');
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        this.logger.warn(`No index.json in ${kind} scripts dir: ${dir}`);
        return [];
      }
      throw e;
    }

    const parsed = JSON.parse(raw) as ScriptIndexFile;
    const scripts: ScriptLifecycle[] = [];

    for (const cfg of parsed.scripts || []) {
      if (cfg.enabled === false) continue;

      const filePath = path.join(dir, cfg.file);
      const mod = await import(pathToFileURL(filePath).href);
      const script: ScriptLifecycle =
        (mod.default as ScriptLifecycle) ||
        (mod.script as ScriptLifecycle);

      if (!script || !script.id) {
        throw new Error(
          `Script file "${cfg.file}" (${kind}) did not export ScriptLifecycle`,
        );
      }

      if (script.id !== cfg.id) {
        throw new Error(
          `Script id mismatch for "${cfg.file}" (${kind}): index.json has "${cfg.id}", script has "${script.id}"`,
        );
      }

      if (cfg.dependsOn) {
        script.dependsOn = cfg.dependsOn;
      }

      scripts.push(script);
    }

    return scripts;
  }
}
