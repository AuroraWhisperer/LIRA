'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');
const REQUIRED_GOVERNANCE_FILES = [
  'AGENTS.md',
  'PLANS.md',
  'docs/architecture/README.md',
  'docs/architecture/adr/0008-ai-assisted-change-governance.md',
  'docs/architecture/engineering/ai-workflow.md',
  'docs/architecture/engineering/legacy-boundaries.md',
  'docs/architecture/engineering/modularity-standard.md',
  'public/js/admin/AGENTS.md',
  'specs/README.md',
  'src/electron/AGENTS.md',
  'src/storage/AGENTS.md',
];
const LINK_CHECK_FILES = [
  ...REQUIRED_GOVERNANCE_FILES,
  'docs/architecture/engineering/build.md',
  'docs/architecture/engineering/test.md',
  'docs/architecture/frontend/app.md',
  'docs/architecture/frontend/pages.md',
];
const REQUIRED_ROUTE_IDS = [
  'ROUTE-MUSIC-REQUESTS',
  'ROUTE-PLAYBACK',
  'ROUTE-WESING',
  'ROUTE-BILIBILI',
  'ROUTE-GIFTS',
  'ROUTE-OVERTIME',
  'ROUTE-AI',
  'ROUTE-STORAGE',
  'ROUTE-SERVER',
  'ROUTE-ELECTRON',
  'ROUTE-ADMIN',
  'ROUTE-OVERLAYS',
];
const ALLOWED_SPEC_STATUSES = new Set([
  'Draft',
  'Accepted',
  'In Progress',
  'Implemented',
  'Reference',
  'Superseded',
]);

function absolutePath(relativePath) {
  return path.resolve(ROOT_DIR, ...relativePath.split('/'));
}

function isInsideRepository(resolvedPath) {
  const relative = path.relative(ROOT_DIR, resolvedPath);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function read(relativePath) {
  const target = absolutePath(relativePath);
  assert.ok(
    fs.existsSync(target),
    report(
      relativePath,
      1,
      'GOV-FILES-001',
      'required checked file is missing',
      `restore ${relativePath}`,
    ),
  );
  return fs.readFileSync(target, 'utf8');
}

function report(relativePath, line, ruleId, reason, suggestedFix) {
  return `${relativePath}:${line} [${ruleId}] ${reason}; suggested fix: ${suggestedFix}`;
}

function assertNoFindings(findings) {
  assert.deepEqual(findings, [], findings.join('\n'));
}

function markedTable(relativePath, startMarker, endMarker, ruleId) {
  const lines = read(relativePath).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === startMarker);
  const end = lines.findIndex((line) => line.trim() === endMarker);
  assert.ok(
    start >= 0 && end > start,
    report(
      relativePath,
      Math.max(start + 1, 1),
      ruleId,
      'marked table is missing or out of order',
      `restore ${startMarker} and ${endMarker}`,
    ),
  );
  return lines.slice(start + 1, end).map((line, index) => ({
    line,
    lineNumber: start + index + 2,
  }));
}

function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function literalPaths(cell) {
  if (!/^`[^`]+`(?:<br>`[^`]+`)*$/.test(cell)) return null;
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function pathExists(relativePath) {
  return fs.existsSync(absolutePath(relativePath));
}

test('required governance files exist', () => {
  const findings = REQUIRED_GOVERNANCE_FILES.filter(
    (relativePath) => !pathExists(relativePath),
  ).map((relativePath) =>
    report(
      relativePath,
      1,
      'GOV-FILES-001',
      'required governance file is missing',
      `create ${relativePath}`,
    ),
  );

  assertNoFindings(findings);
});

test('root constitution references each scoped constitution', () => {
  const root = read('AGENTS.md');
  const scopedFiles = [
    'src/storage/AGENTS.md',
    'src/electron/AGENTS.md',
    'public/js/admin/AGENTS.md',
  ];
  const findings = scopedFiles
    .filter((relativePath) => !root.includes(relativePath))
    .map((relativePath) =>
      report(
        'AGENTS.md',
        1,
        'GOV-ROOT-001',
        `root constitution does not reference ${relativePath}`,
        `add an explicit link to ${relativePath}`,
      ),
    );

  assertNoFindings(findings);
});

test('relative Markdown links in governance and architecture index files resolve', () => {
  const findings = [];

  for (const relativePath of LINK_CHECK_FILES) {
    const source = read(relativePath);
    const links = [
      ...[...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) => ({
        target: match[1],
        index: match.index,
      })),
      ...[...source.matchAll(/^[ \t]{0,3}\[[^\]]+\]:[ \t]+(\S+)/gm)].map(
        (match) => ({ target: match[1], index: match.index }),
      ),
    ];

    for (const link of links) {
      let target = link.target.trim();
      if (target.startsWith('<') && target.endsWith('>'))
        target = target.slice(1, -1);
      if (/^(?:https?:|mailto:|data:|#|\/)/i.test(target)) continue;
      target = target.split('#', 1)[0];
      if (!target) continue;

      const line = source.slice(0, link.index).split(/\r?\n/).length;
      const resolved = path.resolve(
        path.dirname(absolutePath(relativePath)),
        target,
      );
      if (!isInsideRepository(resolved)) {
        findings.push(
          report(
            relativePath,
            line,
            'GOV-LINK-001',
            `relative Markdown link leaves the repository: ${target}`,
            'point the link at a repository-owned file or directory',
          ),
        );
      } else if (!fs.existsSync(resolved)) {
        findings.push(
          report(
            relativePath,
            line,
            'GOV-LINK-001',
            `relative Markdown link does not resolve: ${target}`,
            'point the link at the current owner file or directory',
          ),
        );
      }
    }
  }

  assertNoFindings(findings);
});

test('AI route table has stable unique IDs and existing literal paths', () => {
  const relativePath = 'docs/architecture/engineering/ai-workflow.md';
  const rows = markedTable(
    relativePath,
    '<!-- ROUTE_TABLE_START -->',
    '<!-- ROUTE_TABLE_END -->',
    'GOV-ROUTE-001',
  );
  const findings = [];
  const idLines = new Map();

  for (const { line, lineNumber } of rows) {
    const cells = tableCells(line);
    if (
      !cells ||
      cells[0] === 'Route ID' ||
      cells.every((cell) => /^:?-+:?$/.test(cell))
    )
      continue;
    if (cells.length !== 6) {
      findings.push(
        report(
          relativePath,
          lineNumber,
          'GOV-ROUTE-001',
          'route row must have six cells',
          'restore the Route ID, Domain, Owner, Contract, Typical Consumers, and Tests cells',
        ),
      );
      continue;
    }

    const idMatch = cells[0].match(/^`(ROUTE-[A-Z0-9-]+)`$/);
    if (!idMatch) {
      findings.push(
        report(
          relativePath,
          lineNumber,
          'GOV-ROUTE-001',
          `invalid Route ID cell: ${cells[0]}`,
          'use one backticked uppercase ROUTE-* identifier',
        ),
      );
      continue;
    }

    const routeId = idMatch[1];
    const lines = idLines.get(routeId) || [];
    lines.push(lineNumber);
    idLines.set(routeId, lines);

    for (const column of [2, 3, 5]) {
      const paths = literalPaths(cells[column]);
      if (!paths) {
        findings.push(
          report(
            relativePath,
            lineNumber,
            'GOV-ROUTE-002',
            `${['Owner', 'Contract', 'Tests'][[2, 3, 5].indexOf(column)]} cell must contain only backticked literal paths separated by <br>`,
            'replace prose or wildcards with explicit repository-relative paths',
          ),
        );
        continue;
      }
      for (const candidate of paths) {
        const resolved = absolutePath(candidate);
        const segments = candidate.split(/[\\/]/);
        if (
          path.isAbsolute(candidate) ||
          segments.includes('..') ||
          !isInsideRepository(resolved) ||
          /[*?\[\]{}]/.test(candidate)
        ) {
          findings.push(
            report(
              relativePath,
              lineNumber,
              'GOV-ROUTE-002',
              `route path is not a literal repository-relative path: ${candidate}`,
              'list a concrete path below the repository root',
            ),
          );
        } else if (!fs.existsSync(resolved)) {
          findings.push(
            report(
              relativePath,
              lineNumber,
              'GOV-ROUTE-003',
              `route path does not exist: ${candidate}`,
              'point the route at the current owner, contract, or test path',
            ),
          );
        }
      }
    }
  }

  for (const [routeId, lines] of idLines) {
    if (lines.length > 1) {
      findings.push(
        report(
          relativePath,
          lines[1],
          'GOV-ROUTE-004',
          `duplicate Route ID ${routeId}`,
          'keep one row per stable Route ID',
        ),
      );
    }
  }
  for (const routeId of REQUIRED_ROUTE_IDS) {
    const lines = idLines.get(routeId) || [];
    if (lines.length !== 1) {
      findings.push(
        report(
          relativePath,
          1,
          'GOV-ROUTE-005',
          `required Route ID ${routeId} appears ${lines.length} times`,
          `add exactly one ${routeId} row`,
        ),
      );
    }
  }

  assertNoFindings(findings);
});

test('spec index covers every top-level specification with evidence', () => {
  const relativePath = 'specs/README.md';
  const rows = markedTable(
    relativePath,
    '<!-- SPEC_INDEX_START -->',
    '<!-- SPEC_INDEX_END -->',
    'GOV-SPEC-001',
  );
  const findings = [];
  const indexed = new Map();

  for (const { line, lineNumber } of rows) {
    const cells = tableCells(line);
    if (
      !cells ||
      cells[0] === 'Document' ||
      cells.every((cell) => /^:?-+:?$/.test(cell))
    )
      continue;
    if (cells.length !== 5) {
      findings.push(
        report(
          relativePath,
          lineNumber,
          'GOV-SPEC-001',
          'spec index row must have five cells',
          'restore Document, Type, Status, Runtime Evidence, and Last Reviewed cells',
        ),
      );
      continue;
    }

    const documentMatch = cells[0].match(/^`(specs\/[^`]+\.md)`$/);
    if (!documentMatch) {
      findings.push(
        report(
          relativePath,
          lineNumber,
          'GOV-SPEC-002',
          `invalid specification path cell: ${cells[0]}`,
          'use one backticked top-level specs/*.md path',
        ),
      );
      continue;
    }

    const documentPath = documentMatch[1];
    const lines = indexed.get(documentPath) || [];
    lines.push(lineNumber);
    indexed.set(documentPath, lines);

    if (!ALLOWED_SPEC_STATUSES.has(cells[2])) {
      findings.push(
        report(
          relativePath,
          lineNumber,
          'GOV-SPEC-003',
          `unsupported specification status: ${cells[2]}`,
          'use an allowed lifecycle status',
        ),
      );
    }

    const evidencePaths = literalPaths(cells[3]);
    if (!evidencePaths || evidencePaths.length === 0) {
      findings.push(
        report(
          relativePath,
          lineNumber,
          'GOV-SPEC-004',
          'Runtime Evidence must contain at least one backticked path',
          'list existing source or test evidence',
        ),
      );
    } else {
      for (const evidencePath of evidencePaths) {
        const resolved = absolutePath(evidencePath);
        const segments = evidencePath.split(/[\\/]/);
        if (
          !/^(?:src|public|test)\//.test(evidencePath) ||
          segments.includes('..') ||
          !isInsideRepository(resolved) ||
          !fs.existsSync(resolved)
        ) {
          findings.push(
            report(
              relativePath,
              lineNumber,
              'GOV-SPEC-004',
              `Runtime Evidence path is missing or outside source/test scope: ${evidencePath}`,
              'use an existing src/, public/, or test/ path',
            ),
          );
        }
      }
    }

    const reviewedAt = new Date(`${cells[4]}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(cells[4]) ||
      Number.isNaN(reviewedAt.getTime()) ||
      reviewedAt.toISOString().slice(0, 10) !== cells[4]
    ) {
      findings.push(
        report(
          relativePath,
          lineNumber,
          'GOV-SPEC-005',
          `invalid review date: ${cells[4]}`,
          'record a valid YYYY-MM-DD review date',
        ),
      );
    }
  }

  const topLevelSpecifications = fs
    .readdirSync(absolutePath('specs'), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.md') &&
        entry.name !== 'README.md',
    )
    .map((entry) => `specs/${entry.name}`)
    .sort();

  for (const documentPath of topLevelSpecifications) {
    const lines = indexed.get(documentPath) || [];
    if (lines.length !== 1) {
      findings.push(
        report(
          relativePath,
          1,
          'GOV-SPEC-006',
          `${documentPath} appears ${lines.length} times in the spec index`,
          `index ${documentPath} exactly once`,
        ),
      );
    }
  }
  for (const [documentPath, lines] of indexed) {
    if (!topLevelSpecifications.includes(documentPath)) {
      findings.push(
        report(
          relativePath,
          lines[0],
          'GOV-SPEC-007',
          `indexed document is not a top-level specification: ${documentPath}`,
          'remove the row or move it outside the marked top-level index',
        ),
      );
    } else if (lines.length > 1) {
      findings.push(
        report(
          relativePath,
          lines[1],
          'GOV-SPEC-006',
          `duplicate specification row: ${documentPath}`,
          'keep one evidence-backed row',
        ),
      );
    }
  }

  assertNoFindings(findings);
});
