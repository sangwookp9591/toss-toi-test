import ts from 'typescript-ast';
import type { VfsFiles } from '../../../contracts/src/runtime.ts';
import { ToolError } from './schema.ts';

// Defense in depth only: the preview response CSP enforces the network boundary.
// Static analysis cannot prove that arbitrary JavaScript is safe.
const rules: Array<[string, RegExp]> = [
  ['raw fetch() is forbidden; use @toi/fetch toiFetch', /\bfetch\s*(?:\/\*[\s\S]*?\*\/\s*)?\(/],
  ['XMLHttpRequest is forbidden', /\bXMLHttpRequest\b/],
  ['WebSocket is forbidden', /\bWebSocket\b/],
  ['EventSource is forbidden', /\bEventSource\b/],
  ['navigator.sendBeacon is forbidden', /\bnavigator\s*\.\s*sendBeacon\b/],
  ['http(s) URLs are forbidden', /https?:\/\//i],
  ['/dev/session is forbidden', /\/dev\/session/],
  ['/capabilities is forbidden', /\/capabilities/],
  ['/audit is forbidden', /\/audit/],
  ['writes to __TOI_FETCH_CONFIG__ are forbidden', /\b__TOI_FETCH_CONFIG__(?:["']\s*\])?(?:\s*(?:\.\s*[\w$]+|\[[^\]\n]*\]))*\s*(?:(?:\?\?|\|\||&&|\*\*|[+\-*/%&|^]|<<|>>>?)?=(?!=|>)|\+\+|--)/],
];

export function assertSourcePolicy(files: VfsFiles): void {
  for (const [path, source] of Object.entries(files)) {
    if (!path.startsWith('/src/')) continue;
    assertAstPolicy(path, source);
    for (const [reason, pattern] of rules) {
      if (pattern.test(source)) throw new ToolError(`${path}: ${reason}`);
    }
  }
}

const globals = new Set(['globalThis', 'window', 'self', 'top', 'parent', 'frames']);
function unwrap(node: ts.Node): ts.Node {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}
function isGlobal(node: ts.Node): boolean {
  node = unwrap(node);
  return ts.isIdentifier(node) ? globals.has(node.text) :
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isGlobal(node.expression);
}
function memberName(node: ts.Node): string | undefined {
  node = unwrap(node);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
}
function assertAstPolicy(path: string, source: string) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const deny = (reason: string): never => { throw new ToolError(`${path}: ${reason}`); };
  const visit = (node: ts.Node) => {
    if (ts.isElementAccessExpression(node) && isGlobal(node.expression)) deny('computed global member access is forbidden');
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && !ts.isIdentifier(node.name) && node.initializer && isGlobal(node.initializer)) deny('global destructuring is forbidden');
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && isGlobal(node.right) && (ts.isObjectLiteralExpression(unwrap(node.left)) || ts.isArrayLiteralExpression(unwrap(node.left)))) deny('global destructuring is forbidden');
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = unwrap(node.expression);
      const name = memberName(callee);
      if (callee.kind === ts.SyntaxKind.ImportKeyword) deny('dynamic import is forbidden');
      if (name === 'eval' || name === 'Function') deny('dynamic code evaluation is forbidden');
      if (ts.isNewExpression(node) && (name === 'Worker' || name === 'SharedWorker')) deny('Worker is forbidden');
      if (node.arguments?.some(isGlobal) && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) {
        const owner = unwrap(callee.expression);
        if (ts.isIdentifier(owner) && (owner.text === 'Reflect' || owner.text === 'Object')) deny('reflective global access is forbidden');
      }
    }
    // Reject aliases to the two code evaluators too, including indirect (0, eval).
    if (ts.isIdentifier(node) && (node.text === 'eval' || node.text === 'Function')) deny('dynamic code evaluation is forbidden');
    ts.forEachChild(node, visit);
  };
  visit(file);
}
