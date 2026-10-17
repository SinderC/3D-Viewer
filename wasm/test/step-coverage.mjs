// STEP features beyond plain B-rep parts, checked on small files written here: visibility, layers,
// materials, approvals and organisations, occurrence colours (SHUO), shape representations OCCT
// does not read as it comes (see wasm/patches).
// Usage: node wasm/test/step-coverage.mjs   (DUMP=dir also writes the files there)
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import createOcctViewer from '../build/occt-viewer.js';

// Writes the DATA section of a STEP file; add() returns the new instance's reference.
class Step {
  lines = [];
  add(entity) {
    this.lines.push(`#${this.lines.length + 1}=${entity};`);
    return `#${this.lines.length}`;
  }
  text(schema) {
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION((''),'2;1');",
      "FILE_NAME('test.stp','2026-01-01T00:00:00',(''),(''),'','','');",
      `FILE_SCHEMA(('${schema}'));`,
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n');
  }
}

const AP214 = 'AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }';
const AP203 = 'AP203_CONFIGURATION_CONTROLLED_3D_DESIGN_OF_MECHANICAL_PARTS_AND_ASSEMBLIES_MIM_LF { 1 0 10303 403 3 1 4 }';
const list = (items) => `(${items.join(',')})`;
const pt = (s, [x, y, z]) => s.add(`CARTESIAN_POINT('',(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}))`);
const dir = (s, [x, y, z]) => s.add(`DIRECTION('',(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}))`);
const axis = (s, origin = [0, 0, 0], z = [0, 0, 1], x = [1, 0, 0]) =>
  s.add(`AXIS2_PLACEMENT_3D('',${pt(s, origin)},${dir(s, z)},${dir(s, x)})`);

// Millimetre geometric context.
function context(s) {
  const mm = s.add('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
  const rad = s.add('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
  const sr = s.add('( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )');
  const unc = s.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${mm},'distance_accuracy_value','')`);
  return s.add(
    `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) ` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr})) REPRESENTATION_CONTEXT('','') )`,
  );
}

// Box as a manifold solid B-rep with planar faces and line edges. face is ADVANCED_FACE or FACE_SURFACE.
function box(s, [x0, y0, z0], size, face = 'ADVANCED_FACE') {
  const corner = (i) => [x0 + (i & 1 ? size : 0), y0 + (i & 2 ? size : 0), z0 + (i & 4 ? size : 0)];
  const vertices = [...Array(8).keys()].map((i) => s.add(`VERTEX_POINT('',${pt(s, corner(i))})`));
  const edges = new Map();
  const edge = (a, b) => {
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (!edges.has(key)) {
      const [p, q] = [corner(Math.min(a, b)), corner(Math.max(a, b))];
      const d = q.map((v, k) => (v - p[k]) / size);
      const line = s.add(`LINE('',${pt(s, p)},${s.add(`VECTOR('',${dir(s, d)},${size.toFixed(1)})`)})`);
      edges.set(key, s.add(`EDGE_CURVE('',${vertices[Math.min(a, b)]},${vertices[Math.max(a, b)]},${line},.T.)`));
    }
    return s.add(`ORIENTED_EDGE('',*,*,${edges.get(key)},${a < b ? '.T.' : '.F.'})`);
  };
  // Corners counter-clockwise seen from outside, outward normal.
  const sides = [
    [[0, 2, 3, 1], [0, 0, -1]],
    [[4, 5, 7, 6], [0, 0, 1]],
    [[0, 1, 5, 4], [0, -1, 0]],
    [[2, 6, 7, 3], [0, 1, 0]],
    [[0, 4, 6, 2], [-1, 0, 0]],
    [[1, 3, 7, 5], [1, 0, 0]],
  ];
  const faces = sides.map(([c, n]) => {
    const loop = s.add(`EDGE_LOOP('',${list(c.map((v, k) => edge(v, c[(k + 1) % 4])))})`);
    const ref = corner(c[1]).map((v, k) => (v - corner(c[0])[k]) / size);
    const plane = s.add(`PLANE('',${axis(s, corner(c[0]), n, ref)})`);
    return s.add(`${face}('',(${s.add(`FACE_OUTER_BOUND('',${loop},.T.)`)}),${plane},.T.)`);
  });
  return s.add(`MANIFOLD_SOLID_BREP('',${s.add(`CLOSED_SHELL('',${list(faces)})`)})`);
}

// Part or assembly with its shape representation (an origin placement plus items).
function product(s, ctx, name, items = [], rep = 'SHAPE_REPRESENTATION') {
  const appCtx = s.add("APPLICATION_CONTEXT('automotive design')");
  const prodCtx = s.add(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const prod = s.add(`PRODUCT('${name}','${name}','',(${prodCtx}))`);
  const pdf = s.add(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
  const pdCtx = s.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
  const pd = s.add(`PRODUCT_DEFINITION('design','',${pdf},${pdCtx})`);
  const pds = s.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const origin = axis(s);
  const sr = s.add(`${rep}('${name}',${list([origin, ...items])},${ctx})`);
  s.add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${sr})`);
  return { pd, pds, sr, origin };
}

// One occurrence of child in parent, moved by offset. OCCT names the instance after its id.
function occurrence(s, ctx, parent, child, id, offset = [0, 0, 0]) {
  const nauo = s.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${id}','','',${parent.pd},${child.pd},$)`);
  const pds = s.add(`PRODUCT_DEFINITION_SHAPE('','',${nauo})`);
  const at = axis(s, offset);
  const rel = s.add(
    `( REPRESENTATION_RELATIONSHIP('','',${child.sr},${parent.sr}) ` +
      `REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${s.add(`ITEM_DEFINED_TRANSFORMATION('','',${child.origin},${at})`)}) ` +
      'SHAPE_REPRESENTATION_RELATIONSHIP() )',
  );
  s.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${rel},${pds})`);
  return nauo;
}

// Surface colour; by context for an occurrence (SHUO) style.
function styled(s, item, [r, g, b], context) {
  const colour = s.add(`COLOUR_RGB('',${r.toFixed(1)},${g.toFixed(1)},${b.toFixed(1)})`);
  const fill = s.add(`FILL_AREA_STYLE('',(${s.add(`FILL_AREA_STYLE_COLOUR('',${colour})`)}))`);
  const side = s.add(`SURFACE_SIDE_STYLE('',(${s.add(`SURFACE_STYLE_FILL_AREA(${fill})`)}))`);
  const usage = s.add(`SURFACE_STYLE_USAGE(.BOTH.,${side})`);
  const style = context
    ? s.add(`PRESENTATION_STYLE_BY_CONTEXT((${usage}),${context})`)
    : s.add(`PRESENTATION_STYLE_ASSIGNMENT((${usage}))`);
  return s.add(`STYLED_ITEM('',(${style}),${item})`);
}

const viewer = await createOcctViewer();
let written = 0;
function read(text) {
  if (process.env.DUMP) writeFileSync(`${process.env.DUMP}/${++written}.stp`, text);
  const r = viewer.readModel(new TextEncoder().encode(text), 'test.stp', {}, () => {});
  assert.ok(r.json, r.error);
  return JSON.parse(r.json);
}
const nodeNamed = (model, name) => model.nodes.find((n) => n.name === name);
const props = (model, name) => model.products[nodeNamed(model, name).product]?.props ?? [];

const tests = {
  'invisible parts start hidden, invisible bodies of a part are not drawn'() {
    const s = new Step();
    const ctx = context(s);
    const shown = box(s, [0, 0, 0], 10);
    const construction = box(s, [20, 0, 0], 10);
    const part = product(s, ctx, 'two bodies', [shown, construction], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const hidden = box(s, [0, 20, 0], 10);
    const hiddenPart = product(s, ctx, 'hidden part', [hidden], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const top = product(s, ctx, 'top');
    occurrence(s, ctx, top, part, 'two bodies');
    occurrence(s, ctx, top, hiddenPart, 'hidden part');
    const styles = [styled(s, shown, [0, 0, 1]), styled(s, construction, [0, 1, 0]), styled(s, hidden, [1, 1, 0])];
    s.add(`INVISIBILITY((${styles[1]},${styles[2]}))`);
    s.add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',${list(styles)},${ctx})`);
    const m = read(s.text(AP214));
    assert.equal(nodeNamed(m, 'hidden part')?.hidden, true);
    assert.equal(nodeNamed(m, 'two bodies')?.hidden, undefined);
    const proto = m.protos[nodeNamed(m, 'two bodies').proto];
    assert.equal(proto.indices[1] / 3, 12, 'only the visible box is meshed');
  },

  'what is on a hidden layer is hidden'() {
    const s = new Step();
    const ctx = context(s);
    const shown = box(s, [0, 0, 0], 10);
    const construction = box(s, [20, 0, 0], 10);
    const part = product(s, ctx, 'two bodies', [shown, construction], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const hidden = box(s, [0, 20, 0], 10);
    const hiddenPart = product(s, ctx, 'hidden part', [hidden], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const top = product(s, ctx, 'top');
    occurrence(s, ctx, top, part, 'two bodies');
    occurrence(s, ctx, top, hiddenPart, 'hidden part');
    s.add(`PRESENTATION_LAYER_ASSIGNMENT('Bodies','',(${shown}))`);
    s.add(`INVISIBILITY((${s.add(`PRESENTATION_LAYER_ASSIGNMENT('Construction','',(${construction},${hidden}))`)}))`);
    const m = read(s.text(AP214));
    assert.equal(nodeNamed(m, 'hidden part')?.hidden, true);
    assert.equal(nodeNamed(m, 'two bodies')?.hidden, undefined);
    assert.equal(m.protos[nodeNamed(m, 'two bodies').proto].indices[1] / 3, 12, 'only the visible box is meshed');
  },

  'layers, materials, approvers and organisations are part data'() {
    const s = new Step();
    const ctx = context(s);
    const body = box(s, [0, 0, 0], 10);
    const part = product(s, ctx, 'bracket', [body], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    s.add(`PRESENTATION_LAYER_ASSIGNMENT('Bodies','',(${body}))`);
    s.add(`MATERIAL_DESIGNATION('Steel S235',${part.pd})`);
    // OCCT's material reader took any described property for a material
    const prop = s.add(`PROPERTY_DEFINITION('CAD_SOURCE','',${part.pd})`);
    const rep = s.add(`REPRESENTATION('',(${s.add("DESCRIPTIVE_REPRESENTATION_ITEM('CAD_SOURCE','CATIA')")}),${ctx})`);
    s.add(`PROPERTY_DEFINITION_REPRESENTATION(${prop},${rep})`);
    // Who approved and when; an organisation in a role without a person.
    const approval = s.add(`APPROVAL(${s.add("APPROVAL_STATUS('approved')")},'')`);
    s.add(`APPLIED_APPROVAL_ASSIGNMENT(${approval},(${part.pd}))`);
    const acme = s.add("ORGANIZATION('','ACME','')");
    const person = s.add("PERSON('jd','Doe','Jane',$,$,$)");
    s.add(`APPROVAL_PERSON_ORGANIZATION(${s.add(`PERSON_AND_ORGANIZATION(${person},${acme})`)},${approval},${s.add("APPROVAL_ROLE('approver')")})`);
    const date = s.add('CALENDAR_DATE(2024,15,3)');
    const time = s.add(`LOCAL_TIME(9,30,$,${s.add('COORDINATED_UNIVERSAL_TIME_OFFSET(0,$,.AHEAD.)')})`);
    s.add(`APPROVAL_DATE_TIME(${s.add(`DATE_AND_TIME(${date},${time})`)},${approval})`);
    s.add(`APPLIED_ORGANIZATION_ASSIGNMENT(${acme},${s.add("ORGANIZATION_ROLE('design_supplier')")},(${part.pd}))`);
    const m = read(s.text(AP214));
    const p = props(m, 'bracket');
    assert.ok(p.some(([k, v]) => k === 'Layer' && v === 'Bodies'), JSON.stringify(p));
    assert.deepEqual(p.filter(([k]) => k === 'Material'), [['Material', 'Steel S235']]);
    for (const expected of [['Approval', 'approved'], ['Approver', 'Jane Doe, ACME'], ['Approval date', '2024-03-15 09:30'], ['Design supplier', 'ACME']])
      assert.ok(p.some(([k, v]) => k === expected[0] && v === expected[1]), `${expected} in ${JSON.stringify(p)}`);
  },

  'elementary B-rep (AP203 co28)'() {
    const s = new Step();
    const ctx = context(s);
    product(s, ctx, 'block', [box(s, [0, 0, 0], 10, 'FACE_SURFACE')], 'ELEMENTARY_BREP_SHAPE_REPRESENTATION');
    const m = read(s.text(AP203));
    assert.equal(m.protos[nodeNamed(m, 'block')?.proto]?.indices[1] / 3, 12);
  },

  'a colour on one occurrence of a nested component (SHUO)'() {
    const s = new Step();
    const ctx = context(s);
    const body = box(s, [0, 0, 0], 10);
    const part = product(s, ctx, 'box', [body], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const sub = product(s, ctx, 'sub');
    const top = product(s, ctx, 'top');
    const inSub = occurrence(s, ctx, sub, part, 'box');
    const first = occurrence(s, ctx, top, sub, 's1');
    occurrence(s, ctx, top, sub, 's2', [30, 0, 0]);
    const shuo = s.add(`SPECIFIED_HIGHER_USAGE_OCCURRENCE('','',$,${top.pd},${part.pd},$,${first},${inSub})`);
    const shuoSr = s.add(`SHAPE_REPRESENTATION('',(${axis(s)}),${ctx})`);
    s.add(`SHAPE_DEFINITION_REPRESENTATION(${s.add(`PRODUCT_DEFINITION_SHAPE('','',${shuo})`)},${shuoSr})`);
    const red = styled(s, body, [1, 0, 0], shuoSr);
    s.add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${red}),${ctx})`);
    const m = read(s.text(AP214));
    const boxes = m.nodes.filter((n) => n.name === 'box');
    assert.equal(boxes.length, 2);
    const colours = boxes.map((n) => (n.color >= 0 ? m.colors[n.color].slice(0, 3) : null));
    assert.deepEqual(colours.filter(Boolean), [[1, 0, 0]], JSON.stringify(colours));
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try {
    test();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}
console.log(`${Object.keys(tests).length - failed}/${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
