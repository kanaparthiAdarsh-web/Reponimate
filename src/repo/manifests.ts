import path from 'node:path';
import type { Manifest } from '../core/schemas.js';
import type { RepoFile } from './inventory.js';

function lineOf(text: string, needle: string | RegExp): number {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => (typeof needle === 'string' ? l.includes(needle) : needle.test(l)));
  return idx >= 0 ? idx + 1 : 1;
}

/** Parses the dependency manifests we understand. Uses tolerant regexes for TOML/go.mod so no parser runs repo code. */
export function parseManifest(file: RepoFile): Manifest | null {
  const base = path.posix.basename(file.path);
  const t = file.text;
  try {
    if (base === 'package.json') {
      const j = JSON.parse(t);
      const bin = typeof j.bin === 'string' ? [j.bin] : j.bin && typeof j.bin === 'object' ? Object.values<string>(j.bin) : [];
      const exp = typeof j.exports === 'string' ? j.exports : j.exports?.['.'] ?? j.exports;
      const main = [j.main, j.module, typeof exp === 'string' ? exp : exp?.import ?? exp?.default ?? exp?.require]
        .filter((x): x is string => typeof x === 'string');
      return {
        path: file.path,
        type: 'npm',
        name: typeof j.name === 'string' ? j.name : undefined,
        version: typeof j.version === 'string' ? j.version : undefined,
        description: typeof j.description === 'string' ? j.description : undefined,
        dependencies: Object.keys(j.dependencies ?? {}),
        devDependencies: Object.keys(j.devDependencies ?? {}),
        scripts: Object.fromEntries(Object.entries(j.scripts ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
        bin: bin.map((p) => p.replace(/^\.\//, '')),
        main: main.map((p) => p.replace(/^\.\//, '')),
      };
    }
    if (base === 'pyproject.toml' || base === 'Cargo.toml') {
      const name = t.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
      const version = t.match(/^\s*version\s*=\s*["']([^"']+)["']/m)?.[1];
      const description = t.match(/^\s*description\s*=\s*["']([^"']+)["']/m)?.[1];
      const deps: string[] = [];
      if (base === 'Cargo.toml') {
        const sec = t.match(/\[dependencies\]([\s\S]*?)(\n\[|$)/)?.[1] ?? '';
        for (const m of sec.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)) deps.push(m[1]);
      } else {
        const arr = t.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
        for (const m of arr.matchAll(/["']([A-Za-z0-9_.-]+)/g)) deps.push(m[1]);
        const poetry = t.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/)?.[1] ?? '';
        for (const m of poetry.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)) if (m[1] !== 'python') deps.push(m[1]);
      }
      const scripts: Record<string, string> = {};
      const sec = t.match(/\[project\.scripts\]([\s\S]*?)(\n\[|$)/)?.[1] ?? '';
      for (const m of sec.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']([^"']+)["']/gm)) scripts[m[1]] = m[2];
      return { path: file.path, type: base === 'Cargo.toml' ? 'cargo' : 'python', name, version, description, dependencies: [...new Set(deps)], devDependencies: [], scripts, bin: [], main: [] };
    }
    if (base === 'requirements.txt') {
      const deps = t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
        .map((l) => l.split(/[<>=!~;\[ ]/)[0]);
      return { path: file.path, type: 'python', dependencies: deps, devDependencies: [], scripts: {}, bin: [], main: [] };
    }
    if (base === 'go.mod') {
      const name = t.match(/^module\s+(\S+)/m)?.[1];
      const deps = [...t.matchAll(/^\s+([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v/gm)].map((m) => m[1]);
      return { path: file.path, type: 'go', name, dependencies: deps, devDependencies: [], scripts: {}, bin: [], main: [] };
    }
    if (base === 'Gemfile') {
      const deps = [...t.matchAll(/^\s*gem\s+["']([^"']+)/gm)].map((m) => m[1]);
      return { path: file.path, type: 'ruby', dependencies: deps, devDependencies: [], scripts: {}, bin: [], main: [] };
    }
    if (base === 'composer.json') {
      const j = JSON.parse(t);
      return { path: file.path, type: 'php', name: j.name, description: j.description, dependencies: Object.keys(j.require ?? {}), devDependencies: Object.keys(j['require-dev'] ?? {}), scripts: {}, bin: [], main: [] };
    }
    if (base === 'pom.xml') {
      const deps = [...t.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]).slice(1);
      const description = t.match(/<description>([^<]+)<\/description>/)?.[1];
      return { path: file.path, type: 'maven', name: t.match(/<artifactId>([^<]+)</)?.[1], description, dependencies: deps, devDependencies: [], scripts: {}, bin: [], main: [] };
    }
  } catch {
    return null;
  }
  return null;
}

export { lineOf };

/** Well-known libraries mapped to a human-friendly framework label. */
export const KNOWN_FRAMEWORKS: Record<string, string> = {
  react: 'React', 'react-dom': 'React', next: 'Next.js', vue: 'Vue', nuxt: 'Nuxt', svelte: 'Svelte', '@sveltejs/kit': 'SvelteKit',
  'solid-js': 'Solid', '@angular/core': 'Angular', express: 'Express', fastify: 'Fastify', koa: 'Koa', hono: 'Hono',
  '@nestjs/core': 'NestJS', electron: 'Electron', vite: 'Vite', webpack: 'webpack', jest: 'Jest', vitest: 'Vitest',
  mocha: 'Mocha', ava: 'AVA', commander: 'Commander', yargs: 'yargs', prisma: 'Prisma', '@prisma/client': 'Prisma',
  mongoose: 'Mongoose', typeorm: 'TypeORM', 'socket.io': 'Socket.IO', graphql: 'GraphQL', tailwindcss: 'Tailwind CSS',
  three: 'three.js', d3: 'D3', zod: 'Zod', remotion: 'Remotion', langchain: 'LangChain',
  django: 'Django', flask: 'Flask', fastapi: 'FastAPI', pydantic: 'Pydantic', torch: 'PyTorch', tensorflow: 'TensorFlow',
  numpy: 'NumPy', pandas: 'pandas', 'scikit-learn': 'scikit-learn', transformers: 'Hugging Face Transformers',
  click: 'Click', typer: 'Typer', pytest: 'pytest', sqlalchemy: 'SQLAlchemy', celery: 'Celery', streamlit: 'Streamlit',
  gradio: 'Gradio', requests: 'Requests', httpx: 'HTTPX', aiohttp: 'aiohttp', jax: 'JAX',
  tokio: 'Tokio', serde: 'Serde', clap: 'clap', actix: 'Actix', 'actix-web': 'Actix Web', axum: 'Axum', rocket: 'Rocket',
  bevy: 'Bevy', 'github.com/gin-gonic/gin': 'Gin', 'github.com/spf13/cobra': 'Cobra', 'github.com/labstack/echo/v4': 'Echo',
  'github.com/gofiber/fiber/v2': 'Fiber', rails: 'Ruby on Rails', sinatra: 'Sinatra', 'laravel/framework': 'Laravel',
  'spring-boot-starter': 'Spring Boot', 'spring-boot-starter-web': 'Spring Boot',
};
