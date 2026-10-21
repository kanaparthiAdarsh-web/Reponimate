import { z } from 'zod';

/* ---------- Shared ---------- */

export const ModeSchema = z.enum(['repo-video', 'doc-video', 'doc-reel']);
export type Mode = z.infer<typeof ModeSchema>;

export const FormatSchema = z.enum(['landscape', 'portrait']);
export type Format = z.infer<typeof FormatSchema>;

export const EvidenceSchema = z.object({
  sourceId: z.string(),
  path: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  chunkId: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** verified = quoted/derived directly from a source; interpretation = reasoned from verified facts;
 * unverified = plausible but not backed by evidence; unknown = we could not determine it. */
export const ClaimStatusSchema = z.enum(['verified', 'interpretation', 'unverified', 'unknown']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ClaimSchema = z.object({
  text: z.string(),
  status: ClaimStatusSchema,
  evidence: z.array(EvidenceSchema).default([]),
});
export type Claim = z.infer<typeof ClaimSchema>;

/* ---------- Knowledge base (RAG corpus) ---------- */

export const SourceSchema = z.object({
  id: z.string(),
  kind: z.enum(['repo', 'text', 'web', 'wikipedia', 'hackernews']),
  title: z.string(),
  url: z.string().optional(),
  license: z.string().optional(),
  attribution: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const ChunkSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  path: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  kind: z.enum(['code', 'doc', 'config', 'meta']),
  heading: z.string().optional(),
  text: z.string(),
});
export type Chunk = z.infer<typeof ChunkSchema>;

export const KnowledgeBaseSchema = z.object({
  sources: z.array(SourceSchema),
  chunks: z.array(ChunkSchema),
});
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;

/* ---------- Analysis ---------- */

export const GraphSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), label: z.string(), group: z.string().optional() })),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })),
});
export type Graph = z.infer<typeof GraphSchema>;

export const ManifestSchema = z.object({
  path: z.string(),
  type: z.string(),
  name: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  devDependencies: z.array(z.string()).default([]),
  scripts: z.record(z.string(), z.string()).default({}),
  bin: z.array(z.string()).default([]),
  main: z.array(z.string()).default([]),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const RepoAnalysisSchema = z.object({
  kind: z.literal('repo'),
  title: z.string(),
  repo: z.object({
    owner: z.string(),
    name: z.string(),
    url: z.string(),
    ref: z.string().optional(),
    commitSha: z.string(),
  }),
  size: z.enum(['tiny', 'small', 'medium', 'large']),
  purpose: ClaimSchema,
  audience: ClaimSchema,
  languages: z.array(z.object({ name: z.string(), files: z.number(), lines: z.number() })),
  frameworks: z.array(ClaimSchema),
  manifests: z.array(ManifestSchema),
  entryPoints: z.array(z.object({ path: z.string(), reason: z.string(), evidence: z.array(EvidenceSchema) })),
  modules: z.array(
    z.object({ path: z.string(), responsibility: ClaimSchema, fanIn: z.number(), fanOut: z.number() }),
  ),
  importGraph: GraphSchema,
  keyFiles: z.array(z.object({ path: z.string(), score: z.number(), reasons: z.array(z.string()) })),
  setup: z.array(ClaimSchema),
  usageCommands: z.array(z.object({ command: z.string(), evidence: EvidenceSchema })),
  tests: z.object({ files: z.array(z.string()), frameworks: z.array(z.string()), executed: z.literal(false) }),
  license: z.object({ spdx: z.string().optional(), file: z.string().optional(), warning: z.string().optional() }),
  strengths: z.array(ClaimSchema),
  weaknesses: z.array(ClaimSchema),
  uncertainties: z.array(z.string()),
  stats: z.object({
    files: z.number(),
    lines: z.number(),
    bytes: z.number(),
    sourceFiles: z.number(),
    testFiles: z.number(),
    docFiles: z.number(),
    skippedFiles: z.number(),
  }),
  fileTree: z.array(z.string()),
});
export type RepoAnalysis = z.infer<typeof RepoAnalysisSchema>;

export const DocAnalysisSchema = z.object({
  kind: z.literal('document'),
  title: z.string(),
  summary: ClaimSchema,
  sections: z.array(
    z.object({
      heading: z.string(),
      chunkIds: z.array(z.string()),
      keyPoints: z.array(ClaimSchema),
    }),
  ),
  keyTerms: z.array(z.string()),
  numbers: z.array(ClaimSchema),
  stats: z.object({ words: z.number(), sections: z.number(), sources: z.number() }),
  uncertainties: z.array(z.string()),
});
export type DocAnalysis = z.infer<typeof DocAnalysisSchema>;

export const AnalysisSchema = z.discriminatedUnion('kind', [RepoAnalysisSchema, DocAnalysisSchema]);
export type Analysis = z.infer<typeof AnalysisSchema>;

/* ---------- Visual theme ---------- */

export const PaletteSchema = z.object({
  name: z.string(),
  bg: z.string(),
  bg2: z.string(),
  panel: z.string(),
  panelBorder: z.string(),
  codeBg: z.string(),
  primary: z.string(),
  secondary: z.string(),
  tertiary: z.string(),
  text: z.string(),
  muted: z.string(),
  ink: z.string(),
  board: z.string(),
  boardInk: z.string(),
  success: z.string(),
  danger: z.string(),
});
export type Palette = z.infer<typeof PaletteSchema>;

/* ---------- Script ---------- */

export const SceneTypeSchema = z.enum([
  'intro',
  'problem',
  'overview',
  'architecture',
  'code',
  'terminal',
  'feature-demo',
  'data-flow',
  'stats',
  'comparison',
  'pros-cons',
  'conclusion',
  'outro',
  // explainer / reel scene types
  'presenter',
  'bullets',
  'definition',
  'hook',
]);
export type SceneType = z.infer<typeof SceneTypeSchema>;

export const PoseSchema = z.enum(['wave', 'point', 'think', 'explain', 'celebrate', 'confused', 'walk', 'present']);
export type Pose = z.infer<typeof PoseSchema>;

export const PropSchema = z.enum(['bulb', 'gear', 'magnifier', 'laptop', 'rocket', 'none']);
export type Prop = z.infer<typeof PropSchema>;

export const VisualSchema = z.object({
  headline: z.string().optional(),
  subhead: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  code: z
    .object({
      path: z.string(),
      language: z.string(),
      startLine: z.number().int(),
      endLine: z.number().int(),
      code: z.string(),
      highlight: z.array(z.number().int()).default([]),
    })
    .optional(),
  graph: GraphSchema.optional(),
  stats: z.array(z.object({ label: z.string(), value: z.number(), suffix: z.string().optional() })).optional(),
  pros: z.array(z.string()).optional(),
  cons: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  compare: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
  presenter: z
    .object({
      pose: PoseSchema,
      board: z.array(z.string()).default([]),
      speech: z.string().optional(),
      second: PoseSchema.optional(),
      /** Poses cycled at sentence boundaries so the character keeps moving while it talks. */
      poses: z.array(PoseSchema).optional(),
      prop: PropSchema.optional(),
    })
    .optional(),
  /** Companion host figure shown beside a panel (code, terminal, pros/cons) in repo videos. */
  host: z.object({ poses: z.array(PoseSchema), prop: PropSchema.optional() }).optional(),
  bars: z.array(z.object({ label: z.string(), value: z.number() })).optional(),
  /** Flowchart derived statically from the code excerpt; node lines tie it to the highlighted code. */
  flow: z
    .object({
      nodes: z.array(z.object({ id: z.string(), kind: z.enum(['start', 'decision', 'loop', 'process', 'return', 'error']), label: z.string(), line: z.number().int() })),
      edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })),
    })
    .optional(),
  terminal: z
    .object({
      label: z.string(),
      lines: z.array(z.object({ kind: z.enum(['cmd', 'note']), text: z.string() })),
    })
    .optional(),
});
export type Visual = z.infer<typeof VisualSchema>;

export const SceneSchema = z.object({
  id: z.string(),
  type: SceneTypeSchema,
  title: z.string(),
  narration: z.string().min(1),
  visualDescription: z.string(),
  visual: VisualSchema,
  evidence: z.array(EvidenceSchema),
  emphasisWords: z.array(z.string()),
  estimatedSeconds: z.number().positive(),
  transition: z.enum(['fade', 'slide', 'wipe', 'zoom', 'none']),
  captions: z.object({ enabled: z.boolean(), maxWords: z.number().int().positive() }),
  sfx: z.string().optional(),
  verification: z.object({
    status: z.enum(['verified', 'qualified', 'unverified']),
    supportedSentences: z.number().int(),
    droppedSentences: z.array(z.string()),
    notes: z.array(z.string()),
  }),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScriptSchema = z.object({
  mode: ModeSchema,
  format: FormatSchema,
  title: z.string(),
  subject: z.string(),
  url: z.string().optional(),
  generatedBy: z.object({ provider: z.string(), model: z.string() }),
  wordCount: z.number().int(),
  theme: PaletteSchema.optional(),
  channelName: z.string().max(40).optional(),
  presenter: z.enum(['2d', '3d']).optional(),
  scenes: z.array(SceneSchema).min(1),
});
export type Script = z.infer<typeof ScriptSchema>;

/* ---------- Timing ---------- */

export const WordTimingSchema = z.object({ text: z.string(), start: z.number(), end: z.number() });
export type WordTiming = z.infer<typeof WordTimingSchema>;

export const TimingSchema = z.object({
  fps: z.number().int(),
  totalSec: z.number(),
  scenes: z.array(
    z.object({
      id: z.string(),
      audioFile: z.string(),
      startSec: z.number(),
      speechSec: z.number(),
      durationSec: z.number(),
      alignment: z.enum(['whisper', 'proportional']),
      words: z.array(WordTimingSchema),
    }),
  ),
});
export type Timing = z.infer<typeof TimingSchema>;

/* ---------- Metadata & quality ---------- */

export const MetadataSchema = z.object({
  titles: z.array(z.string().max(70)).length(3),
  description: z.string(),
  chapters: z.array(z.object({ time: z.string(), title: z.string() })),
  tags: z.array(z.string()).min(5).max(15),
  thumbnailText: z.string(),
  thumbnailPrompt: z.string(),
  hashtags: z.array(z.string()),
});
export type Metadata = z.infer<typeof MetadataSchema>;

export const QualityCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  severity: z.enum(['error', 'warning', 'info']),
  detail: z.string(),
});

export const QualityReportSchema = z.object({
  ok: z.boolean(),
  generatedAt: z.string(),
  checks: z.array(QualityCheckSchema),
  uncertainClaims: z.array(z.string()),
  limitations: z.array(z.string()),
  licenseNotes: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type QualityReport = z.infer<typeof QualityReportSchema>;

/* ---------- Job input ---------- */

export const JobInputSchema = z.object({
  mode: ModeSchema,
  repoUrl: z.string().optional(),
  ref: z.string().optional(),
  text: z.string().optional(),
  textTitle: z.string().optional(),
  urls: z.array(z.string()).default([]),
  topic: z.string().optional(),
  preview: z.boolean().default(false),
  chunkRender: z.boolean().default(false),
  noMusic: z.boolean().default(false),
  channelName: z
    .string()
    .trim()
    .max(40)
    .regex(/^[^<>{}\n\r]*$/, 'Channel name cannot contain < > { } or line breaks')
    .optional(),
});
export type JobInput = z.infer<typeof JobInputSchema>;
