import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { SQLWrapper } from 'drizzle-orm';
import { loadFixtureModule } from './load-fixture-module';

/** Execute the actual column whitelist in isolation from routes, auth, and database I/O. */
export function loadTableSortFields(path: string, scope: { isGlobal: boolean; canViewFinancials: boolean }) {
  const source = readFileSync(path, 'utf8');
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let fields = '';
  const declarations: { name: string; code: string }[] = [];
  const prerequisites = new Set(['quantity', 'receivedAt', 'movementSku', 'movementClock']);
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'tableOrderBy') fields = node.arguments[1].getText(tree);
    if (ts.isVariableDeclaration(node) && prerequisites.has(node.name.getText(tree))) {
      declarations.push({ name: node.name.getText(tree), code: `const ${node.getText(tree)};` });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!fields) throw new Error(`Missing tableOrderBy in ${path}`);
  const imports = tree.statements.filter(ts.isImportDeclaration).filter(node =>
    /drizzle-orm|db\/schema|customer-shipping-rate|order-status|shipment-status|shipment-item-sort|table-sort|inventory-stock-math|return-reference/.test(node.moduleSpecifier.getText(tree)),
  ).map(node => node.getText(tree)).join('\n');
  // Use the real inventory quantity owner with its I/O boundary removed.
  const math = loadFixtureModule('src/services/inventory-stock-math.ts', { '../db/client': { db: {} } });
  const module = loadFixtureModule(path, { '../../../services/inventory-stock-math': math }, `
    ${imports}
    export function fields(scope: any) {
      ${declarations.filter(d => new RegExp(`\\b${d.name}\\b`).test(fields)).map(d => d.code).join('\n')}
      return ${fields};
    }
  `);
  return module.fields(scope) as Record<string, SQLWrapper | undefined>;
}
