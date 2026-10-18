// STEP features beyond plain B-rep parts, checked on small files written here: visibility, layers,
// materials, approvals and organisations, occurrence colours (SHUO), shape representations OCCT
// does not read as it comes (see wasm/patches).
// Usage: node wasm/test/step-coverage.mjs   (DUMP=dir also writes the files there, VERBOSE=1 shows volumes)
// e.g. DUMP=samples/step-coverage, where the sample runs then load them too.
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
  // header: more header entities, such as !EXTERNAL_ANCHOR(...)
  text(schema, header = []) {
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION((''),'2;1');",
      "FILE_NAME('test.stp','2026-01-01T00:00:00',(''),(''),'','','');",
      `FILE_SCHEMA(('${schema}'));`,
      ...header,
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n');
  }
}

const AP214 = 'AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }';
const AP242 = 'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }';
const AP203 = 'AP203_CONFIGURATION_CONTROLLED_3D_DESIGN_OF_MECHANICAL_PARTS_AND_ASSEMBLIES_MIM_LF { 1 0 10303 403 3 1 4 }';
const list = (items) => `(${items.join(',')})`;
const pt = (s, [x, y, z]) => s.add(`CARTESIAN_POINT('',(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}))`);
const dir = (s, [x, y, z]) => s.add(`DIRECTION('',(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}))`);
const axis = (s, origin = [0, 0, 0], z = [0, 0, 1], x = [1, 0, 0]) =>
  s.add(`AXIS2_PLACEMENT_3D('',${pt(s, origin)},${dir(s, z)},${dir(s, x)})`);

// Millimetre geometric context.
// inch: lengths in inches (a conversion based unit), else millimetres.
function context(s, inch = false) {
  let mm = s.add('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
  if (inch) {
    const factor = s.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),${mm})`);
    const dims = s.add('DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)');
    mm = s.add(`( CONVERSION_BASED_UNIT('INCH',${factor}) LENGTH_UNIT() NAMED_UNIT(${dims}) )`);
  }
  const rad = s.add('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
  const sr = s.add('( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )');
  const unc = s.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${mm},'distance_accuracy_value','')`);
  return s.add(
    `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) ` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr})) REPRESENTATION_CONTEXT('','') )`,
  );
}

// Box as a manifold solid B-rep with planar faces and line edges. face is ADVANCED_FACE or FACE_SURFACE.
// out.faces gets the faces: -z, +z, -y, +y, -x, +x.
function box(s, [x0, y0, z0], size, face = 'ADVANCED_FACE', out = {}) {
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
  out.faces = faces;
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

// One occurrence of child in parent, moved by offset. OCCT names the instance after its id, which is
// also its reference designator.
function occurrence(s, ctx, parent, child, id, offset = [0, 0, 0]) {
  const nauo = s.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${id}','','',${parent.pd},${child.pd},'${id}')`);
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
// name: the file's name, also where DUMP writes it. files: other files opened with it, {name: text}.
function readResult(name, text, files = {}) {
  if (process.env.DUMP) for (const [n, t] of Object.entries({ [name]: text, ...files })) writeFileSync(`${process.env.DUMP}/${n}`, t);
  const encode = (t) => new TextEncoder().encode(t);
  const opened = Object.entries(files).map(([n, t]) => ({ name: n, bytes: encode(t) }));
  return viewer.readModel(encode(text), name, { files: opened }, () => {});
}
function read(name, text, files) {
  const r = readResult(name, text, files);
  assert.ok(r.json, r.error);
  return { ...JSON.parse(r.json), geometry: r.geometry.slice().buffer };
}

// Enclosed volume of a part's mesh, in mm3: negative when inside out.
function volume(model, node) {
  const p = model.protos[node.proto];
  const pos = new Float32Array(model.geometry, ...p.positions);
  const idx = new Uint32Array(model.geometry, ...p.indices);
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => pos.subarray(i * 3, i * 3 + 3));
    v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return v / 6;
}
// Within a relative tolerance; meshing loses about 0.05% of these volumes.
function near(actual, expected, tolerance, what) {
  if (process.env.VERBOSE) console.log(`     ${what} ${actual.toFixed(2)}, expected ${expected.toFixed(2)}`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.abs(expected), `${what}: ${actual} is not ${expected}`);
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
    const m = read('invisible-parts-and-bodies.stp', s.text(AP214));
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
    const m = read('hidden-layer.stp', s.text(AP214));
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
    const m = read('part-data.stp', s.text(AP214));
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
    const m = read('elementary-brep.stp', s.text(AP203));
    assert.equal(m.protos[nodeNamed(m, 'block')?.proto]?.indices[1] / 3, 12);
  },

  'CSG: primitives, booleans and half-spaces (AP203 co20)'() {
    const s = new Step();
    const ctx = context(s);
    const ax1 = (origin, z) => s.add(`AXIS1_PLACEMENT('',${pt(s, origin)},${dir(s, z)})`);
    const block = s.add(`BLOCK('',${axis(s)},40.,20.,10.)`);
    const hole = s.add(`RIGHT_CIRCULAR_CYLINDER('',${ax1([10, 10, -1], [0, 0, 1])},12.,3.)`);
    // Cone on the block, apex up: the placement is at the apex and points out of the solid.
    const cone = s.add(`RIGHT_CIRCULAR_CONE('',${ax1([30, 10, 20], [0, 0, 1])},10.,0.,0.463647609)`);
    const cut = s.add(`BOOLEAN_RESULT('',.DIFFERENCE.,${block},${hole})`);
    const withCone = s.add(`BOOLEAN_RESULT('',.UNION.,${cut},${cone})`);
    // Material below z = 15 (the plane normal points away from it): trims the cone, not the block.
    const below = s.add(`HALF_SPACE_SOLID('',${s.add(`PLANE('',${axis(s, [0, 0, 15])})`)},.T.)`);
    const trimmed = s.add(`BOOLEAN_RESULT('',.INTERSECTION.,${withCone},${below})`);
    const ball = s.add(`SPHERE('',2.,${pt(s, [60, 0, 0])})`);
    const ring = s.add(`TORUS('',${ax1([60, 0, 0], [0, 0, 1])},6.,1.)`);
    const wedge = s.add(`RIGHT_ANGULAR_WEDGE('',${axis(s, [0, 40, 0])},10.,10.,10.,4.)`);
    const solids = [trimmed, s.add(`BOOLEAN_RESULT('',.UNION.,${ball},${ring})`), wedge].map((t) => s.add(`CSG_SOLID('',${t})`));
    product(s, ctx, 'csg', solids, 'CSG_SHAPE_REPRESENTATION');
    const m = read('csg.stp', s.text(AP203));
    const frustum = (r1, r2, h) => (Math.PI * h / 3) * (r1 * r1 + r1 * r2 + r2 * r2);
    const expected =
      40 * 20 * 10 - Math.PI * 3 * 3 * 10 + // block less the hole through it
      frustum(5, 2.5, 5) + // the cone on top (z 10..20, base radius 5) up to z = 15
      (4 / 3) * Math.PI * 2 ** 3 + 2 * Math.PI ** 2 * 6 * 1 ** 2 + // sphere and torus, apart
      ((10 + 4) / 2) * 10 * 10; // wedge
    near(volume(m, nodeNamed(m, 'csg')), expected, 0.002, 'volume');
  },

  'swept solids: extruded and revolved areas and faces (AP203 co72)'() {
    const s = new Step();
    const ctx = context(s);
    // 10 x 5 rectangle in the z = 0 plane.
    const rect = (x0) => {
      const corners = [[x0, 0, 0], [x0 + 10, 0, 0], [x0 + 10, 5, 0], [x0, 5, 0], [x0, 0, 0]].map((p) => pt(s, p));
      return s.add(`POLYLINE('',${list(corners)})`);
    };
    const plane = () => s.add(`PLANE('',${axis(s)})`);
    const area = (x0) =>
      s.add(
        `CURVE_BOUNDED_SURFACE('',${plane()},(${s.add(`BOUNDARY_CURVE('',(${s.add(`COMPOSITE_CURVE_SEGMENT(.CONTINUOUS.,.T.,${rect(x0)})`)}),.F.)`)}),.F.)`,
      );
    const extruded = s.add(`EXTRUDED_AREA_SOLID('',${area(0)},${dir(s, [0, 0, 1])},20.)`);
    // Rectangle x 20..30 turned half way about the y axis: a half ring of radius 20..30, height 5.
    const revolved = s.add(`REVOLVED_AREA_SOLID('',${area(20)},${s.add(`AXIS1_PLACEMENT('',${pt(s, [0, 0, 0])},${dir(s, [0, 1, 0])})`)},3.14159265358979)`);
    const face = s.add(`FACE_SURFACE('',(${s.add(`FACE_OUTER_BOUND('',${s.add(`POLY_LOOP('',${list([[50, 0, 0], [60, 0, 0], [60, 5, 0], [50, 5, 0]].map((p) => pt(s, p)))})`)},.T.)`)}),${plane()},.T.)`);
    const extrudedFace = s.add(`EXTRUDED_FACE_SOLID('',${face},${dir(s, [0, 0, -1])},4.)`);
    product(s, ctx, 'swept', [extruded, revolved, extrudedFace]);
    const m = read('swept-solids.stp', s.text(AP203));
    const expected = 10 * 5 * 20 + (Math.PI / 2) * (30 * 30 - 20 * 20) * 5 + 10 * 5 * 4;
    near(volume(m, nodeNamed(m, 'swept')), expected, 0.002, 'volume');
    // Polyline outlines sweep to a face per segment (6 faces a solid), not one creased face that
    // the mesher refines without end at its creases.
    const proto = m.protos[nodeNamed(m, 'swept').proto];
    assert.equal(proto.faceStarts[1], 18, 'faces');
    assert.ok(proto.indices[1] / 3 < 2000, `${proto.indices[1] / 3} triangles`);
  },

  'parts in other files (external references), opened together or not'() {
    const part = new Step();
    product(part, context(part), 'box', [box(part, [0, 0, 0], 10)], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    // bracket: a part of its own too, so it shows something without the other file.
    // format: the document's 'data format' property (ExtRef RP 6.3.2), in a REPRESENTATION as the
    // practice writes it, or in a SHAPE_REPRESENTATION as older files do (format = [value, true]).
    // managed: the file is a constituent of a managed document ("document as product", ExtRef RP
    // 5.3-5.5) that the part references, not referenced directly.
    // location: the file's external_source path (ExtRef RP 5.2.3), as written.
    // kind: the document_representation_type, 'digital' or 'physical' (ExtRef RP 5.2.1.2).
    const assembly = (file, { bracket = false, format = null, managed = false, location = null, kind = 'digital' } = {}) => {
      const s = new Step();
      const ctx = context(s);
      const top = product(s, ctx, 'top');
      const ref = product(s, ctx, 'box'); // no shape here: it is in the other file
      occurrence(s, ctx, top, ref, 'first');
      occurrence(s, ctx, top, ref, 'second', [20, 0, 0]);
      if (bracket) occurrence(s, ctx, top, product(s, ctx, 'bracket', [box(s, [0, 20, 0], 10)], 'ADVANCED_BREP_SHAPE_REPRESENTATION'), 'bracket');
      const doc = s.add(`DOCUMENT_FILE('${file}','',$,${s.add("DOCUMENT_TYPE('')")},'',$)`);
      s.add(`DOCUMENT_REPRESENTATION_TYPE('${kind}',${doc})`);
      if (format) {
        const [value, shapeRep] = [].concat(format);
        const items = `(${s.add(`DESCRIPTIVE_REPRESENTATION_ITEM('data format','${value}')`)})`;
        const rep = s.add(`${shapeRep ? 'SHAPE_REPRESENTATION' : 'REPRESENTATION'}('document format',${items},${s.add("REPRESENTATION_CONTEXT('','document parameters')")})`);
        s.add(`PROPERTY_DEFINITION_REPRESENTATION(${s.add(`PROPERTY_DEFINITION('document property','',${doc})`)},${rep})`);
      }
      if (location) {
        const role = s.add("IDENTIFICATION_ROLE('external document id and location',$)");
        s.add(`APPLIED_EXTERNAL_IDENTIFICATION_ASSIGNMENT('${file}',${role},${s.add(`EXTERNAL_SOURCE(${location})`)},(${doc}))`);
      }
      let referenced = doc;
      if (managed) {
        const appCtx = s.add("APPLICATION_CONTEXT('managed model based 3d engineering')");
        const prod = s.add(`PRODUCT('doc-1','box model','',(${s.add(`PRODUCT_CONTEXT('',${appCtx},'')`)}))`);
        s.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('document',$,(${prod}))`);
        const version = s.add(`PRODUCT_DEFINITION_FORMATION('A','',${prod})`);
        const pdCtx = s.add(`PRODUCT_DEFINITION_CONTEXT('digital document definition',${appCtx},'')`);
        s.add(`PRODUCT_DEFINITION_WITH_ASSOCIATED_DOCUMENTS('rep-A','',${version},${pdCtx},(${doc}))`);
        referenced = s.add(`DOCUMENT('','',$,${s.add("DOCUMENT_TYPE('configuration controlled document version')")})`);
        s.add(`DOCUMENT_PRODUCT_EQUIVALENCE('equivalence',$,${referenced},${version})`);
      }
      const adr = s.add(`APPLIED_DOCUMENT_REFERENCE(${referenced},'',(${ref.pd}))`);
      s.add(`ROLE_ASSOCIATION(${s.add("OBJECT_ROLE('mandatory',$)")},${adr})`);
      return s.text(AP214);
    };
    const triangles = (m) => m.nodes.filter((n) => n.proto >= 0).map((n) => m.protos[n.proto].indices[1] / 3);

    let m = read('external-assembly.stp', assembly('box.stp'), { 'box.stp': part.text(AP214) });
    assert.deepEqual(triangles(m), [12, 12]);
    assert.deepEqual(m.externalFiles, [{ name: 'box.stp', loaded: true }]);
    // In a folder, or named in other case: matched by name.
    m = read('external-assembly-in-folder.stp', assembly('parts/Box.STP'), { 'box.stp': part.text(AP214) });
    assert.deepEqual(triangles(m), [12, 12]);
    assert.deepEqual(m.externalFiles, [{ name: 'Box.STP', loaded: true }]);
    // Opened alone: says which file is missing.
    const r = readResult('external-assembly.stp', assembly('box.stp'));
    if (r.json) assert.deepEqual(JSON.parse(r.json).externalFiles, [{ name: 'box.stp', loaded: false }]);
    else assert.match(r.error, /box\.stp/);
    // Partly in it: its own part shows, and the missing file is named.
    m = read('external-assembly-partial.stp', assembly('box.stp', { bracket: true }));
    assert.deepEqual(triangles(m), [12]);
    assert.deepEqual(m.externalFiles, [{ name: 'box.stp', loaded: false }]);
    // Where the file says the missing file is: a folder or a URL.
    m = read('external-assembly-location.stp', assembly('box.stp', { bracket: true, location: "'./part_dir/'" }));
    assert.deepEqual(m.externalFiles, [{ name: 'box.stp', loaded: false, location: './part_dir/' }]);
    m = read('external-assembly-location.stp', assembly('box.stp', { location: "IDENTIFIER('https://plm.example.com/parts/')" }), { 'box.stp': part.text(AP214) });
    assert.deepEqual(triangles(m), [12, 12]);
    assert.deepEqual(m.externalFiles, [{ name: 'box.stp', loaded: true, location: 'https://plm.example.com/parts/' }]);
    // Not part files: a paper document, or a file the viewer cannot read, named without a format.
    for (const [file, kind] of [['Archive B, shelf 4', 'physical'], ['spec.pdf', 'digital'], ['box.CATPart', 'digital']]) {
      m = read('external-assembly-document.stp', assembly(file, { bracket: true, kind }));
      assert.equal(m.externalFiles, undefined, file);
    }
    // A managed document: the same tree as a plain file reference, no node for the document.
    m = read('external-assembly-managed.stp', assembly('box.stp', { managed: true, format: 'STEP AP242' }), { 'box.stp': part.text(AP214) });
    assert.deepEqual(triangles(m), [12, 12]);
    assert.deepEqual(m.externalFiles, [{ name: 'box.stp', loaded: true }]);
    assert.deepEqual(m.nodes.map((n) => n.name), ['top', 'first', 'second']);
    // Formats: every STEP Part 21 name (ExtRef RP Table 2, File Compression RP Figure 4) is read,
    // anything else is not.
    for (const format of ['STEP AP242', ['STEP AP242', true], 'STEP AP203E2', 'STEP AP214 CC06', 'ISO 10303-242', 'iso 10303-214e3']) {
      m = read('external-assembly-format.stp', assembly('box.stp', { format }), { 'box.stp': part.text(AP214) });
      assert.deepEqual(triangles(m), [12, 12], String(format));
    }
    // A part in a format the viewer reads (ExtRef RP 6: any format), with or without a format property.
    const stl = ['solid box', ...[[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]].map((t) =>
      `facet normal 0 0 0\nouter loop\n${t.map((i) => `vertex ${[[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]][i].join(' ')}`).join('\n')}\nendloop\nendfacet`), 'endsolid box'].join('\n');
    for (const format of [null, ['STL', true]]) {
      m = read('external-assembly-stl.stp', assembly('parts/box.stl', { format }), { 'box.stl': stl });
      assert.deepEqual(triangles(m), [12, 12], String(format));
      near(Math.abs(volume(m, m.nodes.find((n) => n.proto >= 0))), 1000, 0.001, 'STL part volume');
      assert.deepEqual(m.externalFiles, [{ name: 'box.stl', loaded: true }], String(format));
    }
    m = read('external-assembly-stl.stp', assembly('box.stl', { bracket: true }));
    assert.deepEqual(triangles(m), [12]);
    assert.deepEqual(m.externalFiles, [{ name: 'box.stl', loaded: false }]);
    for (const format of ['ISO 10303-242 Domain Model XML', ['JT', true]]) {
      m = read('external-assembly-format.stp', assembly('box.stp', { bracket: true, format }), { 'box.stp': part.text(AP214) });
      assert.deepEqual(triangles(m), [12], String(format));
      assert.equal(m.externalFiles, undefined, String(format));
    }
  },

  'assembly PMI: on faces of one component instance (component_path_shape_aspect, MLRD)'() {
    // PMI RP 9.3.4, Figure 94: a dimension between the same face of two instances of a part.
    const s = new Step();
    const ctx = context(s);
    const out = {};
    const bracket = product(s, ctx, 'bracket', [box(s, [0, 0, 0], 10, 'ADVANCED_FACE', out)], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const sub = product(s, ctx, 'sub');
    const top = product(s, ctx, 'top');
    const inSub = occurrence(s, ctx, sub, bracket, 'b1');
    const first = occurrence(s, ctx, top, sub, 's1');
    const second = occurrence(s, ctx, top, sub, 's2', [30, 0, 0]);
    const direct = occurrence(s, ctx, top, bracket, 'b2', [0, 30, 0]);
    const side = s.add(`SHAPE_ASPECT('+x side','',${bracket.pds},.T.)`); // the +x face of the bracket
    s.add(`GEOMETRIC_ITEM_SPECIFIC_USAGE('','',${side},${bracket.sr},${out.faces[5]})`);
    const at = (id, location) => s.add(`COMPONENT_PATH_SHAPE_ASPECT('${id}',$,${top.pds},.T.,${location},${side})`);
    const mlrd = (id, path) => s.add(`MULTI_LEVEL_REFERENCE_DESIGNATOR('${id}','','',*,*,'${id}',(${path.join(',')}))`);
    s.add(`DIMENSIONAL_LOCATION('distance','',${at('d1', mlrd('m1', [first, inSub]))},${at('d2', mlrd('m2', [second, inSub]))})`);
    const mm = s.add('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
    s.add(`FLATNESS_TOLERANCE('flat','',${s.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.1),${mm})`)},${at('f', direct)})`);
    // Presentation only, as in the PMI RP's example: the association's definition is the CPSA. A line
    // between the two instances' faces, in the coordinates of the top assembly.
    const line = s.add(`POLYLINE('',(${pt(s, [10, 5, 12])},${pt(s, [40, 5, 12])}))`);
    const curveStyle = s.add("CURVE_STYLE('',DRAUGHTING_PRE_DEFINED_CURVE_FONT('continuous'),POSITIVE_LENGTH_MEASURE(0.5),DRAUGHTING_PRE_DEFINED_COLOUR('black'))");
    const lines = s.add(`GEOMETRIC_CURVE_SET('',(${line}))`);
    const shown = s.add(`ANNOTATION_CURVE_OCCURRENCE('Dimension.1',(${s.add(`PRESENTATION_STYLE_ASSIGNMENT((${curveStyle}))`)}),${lines})`);
    const model = s.add(`DRAUGHTING_MODEL('',(${shown}),${ctx})`);
    s.add(`DRAUGHTING_MODEL_ITEM_ASSOCIATION('Dimension.1',$,${at('p', mlrd('m3', [first, inSub]))},${model},${shown})`);
    const m = read('assembly-pmi.stp', s.text(AP214));

    // The tree: top > s1 > b1, s2 > b1, b2
    const path = (n) => (n.parent < 0 ? [n.name] : [...path(m.nodes[n.parent]), n.name]);
    const named = (...names) => m.nodes.findIndex((n) => path(n).join('/') === names.join('/'));
    const [s1b1, s2b1, b2] = [named('top', 's1', 'b1'), named('top', 's2', 'b1'), named('top', 'b2')];
    assert.ok(s1b1 >= 0 && s2b1 >= 0 && b2 >= 0, JSON.stringify(m.nodes.map(path)));
    // The +x face, as the bridge numbers the bracket's faces
    const proto = m.protos[m.nodes[b2].proto];
    const plusX = [...Array(6).keys()].filter((f) => {
      const d = new Float64Array(m.geometry, ...proto.faceData);
      return d[f * 7] === 1 && d[f * 7 + 4] === 1; // plane with normal +x
    });
    assert.equal(plusX.length, 1, 'one +x face');

    const summary = JSON.stringify(m.pmi.map(({ kind, type, proto, faces, nodes, nodeFaces }) => ({ kind, type, proto, faces, nodes, nodeFaces })));
    const distance = m.pmi.find((p) => p.kind === 'dimension');
    assert.ok(distance, summary);
    assert.equal(distance.proto, -1, `owned by the assembly, not drawn on each bracket: ${summary}`);
    assert.deepEqual(distance.nodes, [named('top')]);
    assert.deepEqual(distance.nodeFaces, [[s1b1, plusX[0]], [s2b1, plusX[0]]]);
    const flat = m.pmi.find((p) => p.type === 'Flatness');
    assert.ok(flat, summary);
    assert.deepEqual(flat.nodes, [named('top')]);
    assert.deepEqual(flat.nodeFaces, [[b2, plusX[0]]]);
    const drawn = m.pmi.find((p) => p.name === 'Dimension.1');
    assert.ok(drawn, summary);
    assert.deepEqual(drawn.nodes, [named('top')]);
    assert.deepEqual(drawn.nodeFaces, [[s1b1, plusX[0]]]);
    assert.deepEqual([...new Float32Array(m.geometry, ...drawn.segments)], [10, 5, 12, 40, 5, 12]);
  },

  'assembly PMI across files: external element references (EXTERNAL_ANCHOR, product_definition_reference)'() {
    // ExtRef RP 7: the part's file anchors the shape aspect; the assembly places the part through an
    // external reference whose product definition is a product_definition_reference_with_local_
    // representation (7.4.1, Figure 27) and dimensions the anchored face of two instances.
    const partFile = new Step();
    const out = {};
    const bracket = product(partFile, context(partFile), 'bracket', [box(partFile, [0, 0, 0], 10, 'ADVANCED_FACE', out)], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const side = partFile.add(`SHAPE_ASPECT('+x side','',${bracket.pds},.T.)`);
    partFile.add(`GEOMETRIC_ITEM_SPECIFIC_USAGE('','',${side},${bracket.sr},${out.faces[5]})`);
    const part = partFile.text(AP242, [`!EXTERNAL_ANCHOR('SIDE-X',${side});`]);

    // A part defined in another file: its local representation, and the reference to the file
    const external = (s, ctx, name, file) => {
      const appCtx = s.add("APPLICATION_CONTEXT('managed model based 3d engineering')");
      const prod = s.add(`PRODUCT('${name}','${name}','',(${s.add(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`)}))`);
      const pdf = s.add(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
      const source = s.add("EXTERNAL_SOURCE('')"); // the file is next to the assembly
      const pd = s.add(`PRODUCT_DEFINITION_REFERENCE_WITH_LOCAL_REPRESENTATION(${source},'design','',${pdf},${s.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`)})`);
      const pds = s.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
      const origin = axis(s);
      const sr = s.add(`SHAPE_REPRESENTATION('${name}',(${origin}),${ctx})`);
      s.add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${sr})`);
      const doc = s.add(`DOCUMENT_FILE('${file}','',$,${s.add("DOCUMENT_TYPE('')")},'',$)`);
      s.add(`DOCUMENT_REPRESENTATION_TYPE('digital',${doc})`);
      const role = s.add("IDENTIFICATION_ROLE('external document id and location',$)");
      s.add(`APPLIED_EXTERNAL_IDENTIFICATION_ASSIGNMENT('${file}',${role},${source},(${doc}))`);
      const adr = s.add(`APPLIED_DOCUMENT_REFERENCE(${doc},'',(${pd}))`);
      s.add(`ROLE_ASSOCIATION(${s.add("OBJECT_ROLE('mandatory',$)")},${adr})`);
      return { pd, pds, sr, origin, source };
    };
    const s = new Step();
    const ctx = context(s);
    const top = product(s, ctx, 'top');
    const ref = external(s, ctx, 'bracket', 'bracket.stp');
    const first = occurrence(s, ctx, top, ref, 'b1');
    const second = occurrence(s, ctx, top, ref, 'b2', [30, 0, 0]);
    const at = (id, location) => s.add(`COMPONENT_PATH_SHAPE_ASPECT('${id}',$,${top.pds},.T.,${location},IDENTIFIER('SIDE-X'))`);
    s.add(`DIMENSIONAL_LOCATION('distance','',${at('d1', first)},${at('d2', second)})`);
    let m = read('eer-assembly.stp', s.text(AP242), { 'bracket.stp': part });

    assert.deepEqual(m.externalFiles, [{ name: 'bracket.stp', loaded: true }]);
    const names = m.nodes.map((n) => n.name);
    const [b1, b2] = [names.indexOf('b1'), names.indexOf('b2')];
    assert.ok(b1 > 0 && b2 > 0 && m.nodes[b1].proto >= 0, JSON.stringify(names));
    const distance = m.pmi.find((p) => p.kind === 'dimension');
    assert.ok(distance, JSON.stringify(m.pmi));
    assert.deepEqual(distance.nodes, [0]);
    assert.deepEqual(distance.nodeFaces.map(([node, ...faces]) => [node, faces.length]), [[b1, 1], [b2, 1]]);

    // Nested (7.4, Figure 26): top places sub.stp, which places bracket.stp. The top file navigates
    // to the bracket in sub.stp with a usage whose parent is the local representation of sub and whose
    // child is a product_definition_reference to the bracket, matched there by reference designator.
    const subFile = new Step();
    const subCtx = context(subFile);
    const sub = product(subFile, subCtx, 'sub');
    occurrence(subFile, subCtx, sub, external(subFile, subCtx, 'bracket', 'bracket.stp'), 'b1');
    const t = new Step();
    const tCtx = context(t);
    const root = product(t, tCtx, 'root');
    const subRef = external(t, tCtx, 'sub', 'sub.stp');
    const s1 = occurrence(t, tCtx, root, subRef, 's1');
    const s2 = occurrence(t, tCtx, root, subRef, 's2', [0, 30, 0]);
    const bracketRef = t.add(`PRODUCT_DEFINITION_REFERENCE(${t.add("EXTERNAL_SOURCE('bracket.stp')")},'bracket','','design',$)`);
    const nav = t.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('b1','','',${subRef.pd},${bracketRef},'b1')`);
    const path = (id, usages) => t.add(`MULTI_LEVEL_REFERENCE_DESIGNATOR('${id}','','',*,*,'${id}',(${usages.join(',')}))`);
    const on = (id, location) => t.add(`COMPONENT_PATH_SHAPE_ASPECT('${id}',$,${root.pds},.T.,${location},IDENTIFIER('SIDE-X'))`);
    t.add(`DIMENSIONAL_LOCATION('across','',${on('a1', path('m1', [s1, nav]))},${on('a2', path('m2', [s2, nav]))})`);
    m = read('eer-nested.stp', t.text(AP242), { 'sub.stp': subFile.text(AP242), 'bracket.stp': part });
    const tree = (n) => (n.parent < 0 ? [n.name] : [...tree(m.nodes[n.parent]), n.name]);
    const leaf = (p) => m.nodes.findIndex((n) => tree(n).join('/') === p);
    const across = m.pmi.find((p) => p.kind === 'dimension');
    assert.ok(across, JSON.stringify(m.nodes.map(tree)));
    assert.deepEqual(across.nodes, [0]);
    assert.deepEqual(across.nodeFaces.map(([node, ...faces]) => [node, faces.length]), [[leaf('root/s1/b1'), 1], [leaf('root/s2/b1'), 1]]);
  },

  'attributes on one component instance: on its NAUO, or deeper down on a MLRD (UDA RP 6.2)'() {
    const s = new Step();
    const ctx = context(s);
    const part = product(s, ctx, 'box', [box(s, [0, 0, 0], 10)], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const sub = product(s, ctx, 'sub');
    const top = product(s, ctx, 'top');
    const inSub = occurrence(s, ctx, sub, part, 'box');
    const first = occurrence(s, ctx, top, sub, 's1');
    occurrence(s, ctx, top, sub, 's2', [30, 0, 0]);
    const attribute = (of, name, value) => {
      const pd = s.add(`PROPERTY_DEFINITION('${name}',$,${of})`);
      const rep = s.add(`REPRESENTATION('',(${s.add(`DESCRIPTIVE_REPRESENTATION_ITEM('${name}','${value}')`)}),${ctx})`);
      s.add(`PROPERTY_DEFINITION_REPRESENTATION(${pd},${rep})`);
      s.add(`GENERAL_PROPERTY_ASSOCIATION('',$,${s.add(`GENERAL_PROPERTY('','${name}',$)`)},${pd})`);
    };
    attribute(first, 'assembly step', '10');
    attribute(s.add(`MULTI_LEVEL_REFERENCE_DESIGNATOR('s1-box','','',*,*,'s1-box',(${first},${inSub}))`), 'torque', '12 Nm');
    const m = read('instance-attributes.stp', s.text(AP242));
    const tree = (n) => (n.parent < 0 ? [n.name] : [...tree(m.nodes[n.parent]), n.name]);
    const at = (path) => m.nodes.find((n) => tree(n).join('/') === path)?.attributes;
    assert.deepEqual(at('top/s1'), [['assembly step', '10']]);
    // Occurrence identification (PDM UG 4.1.1.2): the NAUO's id and reference designator
    assert.deepEqual(m.nodes.find((n) => tree(n).join('/') === 'top/s1').occurrence, [['Id', 's1'], ['Reference designator', 's1']]);
    assert.deepEqual(at('top/s1/box'), [['torque', '12 Nm']]);
    assert.equal(at('top/s2'), undefined);
    assert.equal(at('top/s2/box'), undefined);
  },

  'quantified and promissory usages (PDM UG 4.1.2, 4.1.4)'() {
    const s = new Step();
    const ctx = context(s);
    const gasket = product(s, ctx, 'gasket', [box(s, [0, 0, 0], 10)], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const washer = product(s, ctx, 'washer', [box(s, [0, 0, 0], 2)], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const bolt = product(s, ctx, 'bolt', [box(s, [0, 0, 0], 5)], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const sub = product(s, ctx, 'sub', [box(s, [0, 20, 0], 5)], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const top = product(s, ctx, 'top');
    occurrence(s, ctx, top, sub, 'sub');
    const unit = s.add(`NAMED_UNIT(${s.add('DIMENSIONAL_EXPONENTS(0.,0.,0.,0.,0.,0.,0.)')})`);
    // PDM UG Example 17: next_assembly_usage_occurrence and quantified_assembly_component_usage as
    // one complex instance
    const quantified = (child, id, n) =>
      s.add(
        `(ASSEMBLY_COMPONENT_USAGE($) NEXT_ASSEMBLY_USAGE_OCCURRENCE() PRODUCT_DEFINITION_RELATIONSHIP('${id}','quantified usage',$,${top.pd},${child.pd}) ` +
          `PRODUCT_DEFINITION_USAGE() QUANTIFIED_ASSEMBLY_COMPONENT_USAGE(${s.add(`MEASURE_WITH_UNIT(COUNT_MEASURE(${n}.),${unit})`)}))`,
      );
    const rel = s.add(
      `( REPRESENTATION_RELATIONSHIP('','',${gasket.sr},${top.sr}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${s.add(`ITEM_DEFINED_TRANSFORMATION('','',${gasket.origin},${axis(s, [40, 0, 0])})`)}) SHAPE_REPRESENTATION_RELATIONSHIP() )`,
    );
    s.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${rel},${s.add(`PRODUCT_DEFINITION_SHAPE('','',${quantified(gasket, 'g', 2)})`)})`);
    quantified(washer, 'w', 4); // no placement
    s.add(`PROMISSORY_USAGE_OCCURRENCE('p1','bolt','',${top.pd},${bolt.pd},$)`); // somewhere below top
    const m = read('quantified-usage.stp', s.text(AP214));

    // OCCT read the complex instance as an unknown entity: the gasket was not in the assembly.
    const g = m.nodes.find((n) => n.name === 'quantified usage'); // named after the usage, as any NAUO
    assert.ok(g && m.nodes[g.parent].name === 'top', JSON.stringify(m.nodes.map((n) => n.name)));
    assert.deepEqual(g.matrix.slice(12, 15), [40, 0, 0]);
    assert.deepEqual(g.occurrence, [['Id', 'g'], ['Name', 'quantified usage'], ['Quantity', '2']]);
    assert.deepEqual(props(m, 'top').filter(([k]) => k === 'Not placed' || k === 'Somewhere below'), [
      ['Not placed', 'washer × 4'],
      ['Somewhere below', 'bolt'],
    ]);
  },

  'an assembly with geometry of its own (PDM UG 4.4), e.g. a weld'() {
    const s = new Step();
    const ctx = context(s);
    const part = product(s, ctx, 'plate', [box(s, [0, 0, 0], 10)], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
    const weld = box(s, [10, 0, 0], 2);
    const top = product(s, ctx, 'top', [weld]); // the assembly's shape representation holds the weld
    occurrence(s, ctx, top, part, 'p1');
    occurrence(s, ctx, top, part, 'p2', [12, 0, 0]);
    const m = read('assembly-own-geometry.stp', s.text(AP214));
    const triangles = m.nodes.filter((n) => n.proto >= 0).map((n) => [n.name, m.protos[n.proto].indices[1] / 3]);
    assert.equal(triangles.length, 3, JSON.stringify(m.nodes));
    near(Math.abs(volume(m, m.nodes.find((n) => n.proto >= 0 && !['p1', 'p2'].includes(n.name)))), 8, 0.001, 'weld volume');
  },

  'a part file in other units than its assembly (external reference)'() {
    // assemblyInch: the assembly in inches and the part in mm, else the other way round
    const load = (assemblyInch) => {
      const partFile = new Step();
      product(partFile, context(partFile, !assemblyInch), 'cube', [box(partFile, [0, 0, 0], 1)], 'ADVANCED_BREP_SHAPE_REPRESENTATION');
      const s = new Step();
      const ctx = context(s, assemblyInch);
      const top = product(s, ctx, 'top');
      const ref = product(s, ctx, 'cube');
      occurrence(s, ctx, top, ref, 'c1', [2, 0, 0]);
      const file = `cube-${assemblyInch ? 'mm' : 'inch'}.stp`;
      const doc = s.add(`DOCUMENT_FILE('${file}','',$,${s.add("DOCUMENT_TYPE('')")},'',$)`);
      s.add(`DOCUMENT_REPRESENTATION_TYPE('digital',${doc})`);
      s.add(`ROLE_ASSOCIATION(${s.add("OBJECT_ROLE('mandatory',$)")},${s.add(`APPLIED_DOCUMENT_REFERENCE(${doc},'',(${ref.pd}))`)})`);
      const m = read(`mixed-units-${assemblyInch ? 'inch' : 'mm'}.stp`, s.text(AP214), { [file]: partFile.text(AP214) });
      const cube = m.nodes.find((n) => n.name === 'c1');
      assert.ok(cube && cube.proto >= 0, JSON.stringify(m.nodes));
      return [Math.abs(volume(m, cube)), cube.matrix[12]];
    };
    // Geometry in mm: the part's size from its own file's unit, the placement from the assembly's
    let [v, x] = load(false);
    near(v, 25.4 ** 3, 0.001, 'a one-inch cube in mm3');
    near(x, 2, 1e-9, 'placement in mm');
    [v, x] = load(true);
    near(v, 1, 0.001, 'a one-mm cube');
    near(x, 50.8, 1e-9, 'placement of two inches in mm');
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
    const m = read('shuo-colour.stp', s.text(AP214));
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
