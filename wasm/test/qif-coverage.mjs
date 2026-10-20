// QIF semantic PMI, checked on small files written here: one square face as the model, and the
// PMI under test.
// Usage: node wasm/test/qif-coverage.mjs   (DUMP=dir also writes the files there)
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import createOcctViewer from '../build/occt-viewer.js';

// A QIF document: a 10 mm square face in z = 0 (ids 1–18) and the given sections (ids from 100).
function qif(sections) {
  const corners = ['0 0 0', '10 0 0', '10 10 0', '0 10 0'];
  const ids = (list) => list.map((id) => `<Id>${id}</Id>`).join('');
  const set = (tag, items) => `<${tag} n="${items.length}">${items.join('')}</${tag}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<QIFDocument xmlns="http://qifstandards.org/xsd/qif3" versionQIF="3.0.0" idMax="999">
  <FileUnits><PrimaryUnits><AngularUnit><UnitName>degree</UnitName></AngularUnit>
    <LinearUnit><SIUnitName>meter</SIUnitName><UnitName>mm</UnitName><UnitConversion><Factor>0.001</Factor></UnitConversion></LinearUnit>
  </PrimaryUnits></FileUnits>
  ${sections}
  <Model>
    ${set('PointSet', corners.map((c, i) => `<Point id="${1 + i}"><XYZ>${c}</XYZ></Point>`))}
    ${set('Curve13Set', corners.map((c, i) => `<Segment13 id="${5 + i}"><Segment13Core domain="0 1"><StartPoint>${c}</StartPoint><EndPoint>${corners[(i + 1) % 4]}</EndPoint></Segment13Core></Segment13>`))}
    ${set('SurfaceSet', ['<Plane23 id="9"><Plane23Core domainU="-10 10" domainV="-10 10"><Origin>5 5 0</Origin><DirU>1 0 0</DirU><DirV>0 1 0</DirV></Plane23Core></Plane23>'])}
    ${set('VertexSet', corners.map((_, i) => `<Vertex id="${10 + i}"><Point>${ids([1 + i])}</Point></Vertex>`))}
    ${set('EdgeSet', corners.map((_, i) => `<Edge id="${14 + i}"><Curve>${ids([5 + i])}</Curve><VertexBeg>${ids([10 + i])}</VertexBeg><VertexEnd>${ids([10 + ((i + 1) % 4)])}</VertexEnd></Edge>`))}
    ${set('LoopSet', [`<Loop id="18" form="OUTER">${set('CoEdges', corners.map((_, i) => `<CoEdge><EdgeOriented>${ids([14 + i])}</EdgeOriented></CoEdge>`))}</Loop>`])}
    ${set('FaceSet', [`<Face id="19"><Surface>${ids([9])}</Surface><LoopIds n="1">${ids([18])}</LoopIds></Face>`])}
  </Model>
</QIFDocument>`;
}

const viewer = await createOcctViewer();
function read(name, text) {
  if (process.env.DUMP) writeFileSync(`${process.env.DUMP}/${name}`, text);
  const r = viewer.readModel(new TextEncoder().encode(text), name, { files: [] }, () => {});
  assert.ok(r.json, r.error);
  return JSON.parse(r.json);
}

const tests = {
  'datum reference frame: precedence, compound datums and datum modifiers (ISO 23952 5.17.6)'() {
    const labels = ['A', 'B', 'C', 'D'];
    const definitions = labels.map((l, i) => `<DatumDefinition id="${100 + i}"><DatumLabel>${l}</DatumLabel></DatumDefinition>`);
    // A datum: its label and the elements after DatumDefinitionId
    const datum = (label, extra = '') => `<SimpleDatum><DatumDefinitionId>${100 + labels.indexOf(label)}</DatumDefinitionId>${extra}</SimpleDatum>`;
    const precedence = ['PRIMARY', 'SECONDARY', 'TERTIARY'];
    // order: the precedence of each compartment, as listed
    const frame = (id, compartments, order = precedence) =>
      `<DatumReferenceFrame id="${id}"><Datums n="${compartments.length}">${compartments
        .map((c, i) => `<Datum>${c}<Precedence><PrecedenceEnum>${order[i]}</PrecedenceEnum></Precedence></Datum>`)
        .join('')}</Datums></DatumReferenceFrame>`;
    const frames = [
      // A | B Ⓜ | C Ⓛ, as NIST files write them
      frame(200, [
        datum('A', '<MaterialModifier>NONE</MaterialModifier>'),
        datum('B', '<MaterialModifier> MAXIMUM </MaterialModifier>'),
        datum('C', '<MaterialModifier>LEAST_RPR</MaterialModifier><ContactingFeature>false</ContactingFeature>'),
      ]),
      // A-B Ⓜ | D: a compound datum
      frame(201, [
        `<CompoundDatum n="2"><Datum>${datum('A')}<SequenceNumber>1</SequenceNumber></Datum><Datum>${datum('B', '<MaterialModifier>MAXIMUM</MaterialModifier>')}<SequenceNumber>2</SequenceNumber></Datum></CompoundDatum>`,
        datum('D'),
      ]),
      // ISO elements of DatumType: projected datum 5 mm, [SCS], [LD], [CF], [PL]
      frame(202, [
        datum('A', '<ProjectedDatum>5</ProjectedDatum><DiameterModifier>LD</DiameterModifier><SectionModifier>SCS</SectionModifier><ContactingFeature>1</ContactingFeature><ReducedDatum>PL</ReducedDatum>'),
      ]),
      // Listed SECONDARY first; a value not in the schema, kept as written (and escaped in the JSON)
      frame(203, [datum('B', '<SectionModifier>S&quot;X</SectionModifier>'), datum('A')], ['SECONDARY', 'PRIMARY']),
      // ASME: A [BASIC] ▷ [x,y], B [Ø3]; ISO degrees of freedom on C
      frame(204, [
        datum('A', '<DatumFeatureSimulatorModifier><BasicSize>BASIC</BasicSize></DatumFeatureSimulatorModifier><DatumTranslation><DatumTranslationAllowed>true</DatumTranslationAllowed></DatumTranslation><DegreesOfFreedom n="2"><DegreeOfFreedom>X</DegreeOfFreedom><DegreeOfFreedom>Y</DegreeOfFreedom></DegreesOfFreedom>'),
        datum('B', '<DatumFeatureSimulatorModifier><DiametricalSize>3</DiametricalSize></DatumFeatureSimulatorModifier>'),
        datum('C', '<DegreesOfFreedom n="2"><ISODegreeOfFreedom>Tx</ISODegreeOfFreedom><ISODegreeOfFreedom>Rz</ISODegreeOfFreedom></DegreesOfFreedom>'),
      ]),
      // A nested compound datum [PL], listed out of sequence: (C-(D-A Ⓜ [PL])) [PL]
      frame(205, [
        `<CompoundDatum n="2"><Datum><CompoundDatum n="2"><Datum>${datum('A', '<MaterialModifier>MAXIMUM</MaterialModifier><ReducedDatum>PL</ReducedDatum>')}<SequenceNumber>2</SequenceNumber></Datum><Datum>${datum('D')}<SequenceNumber>1</SequenceNumber></Datum></CompoundDatum><SequenceNumber>2</SequenceNumber></Datum><Datum>${datum('C')}<SequenceNumber>1</SequenceNumber></Datum><ReducedDatum>PL</ReducedDatum></CompoundDatum>`,
      ]),
      // Datum features without a datum label, named by their feature (or its id): PLANE1 Ⓜ | feature 999 | B
      frame(206, [
        '<MeasuredDatumFeature><FeatureNominalId>150</FeatureNominalId><MaterialModifier>MAXIMUM</MaterialModifier></MeasuredDatumFeature>',
        '<NominalDatumFeature><FeatureNominalId>999</FeatureNominalId></NominalDatumFeature>',
        datum('B'),
      ]),
      // A simulator size and a projected datum: A [Ø3] [Ⓟ 5]
      frame(207, [datum('A', '<DatumFeatureSimulatorModifier><DiametricalSize>3</DiametricalSize></DatumFeatureSimulatorModifier><ProjectedDatum>5</ProjectedDatum>')]),
    ];
    const definitionsXml = (frameId, value, i) =>
      `<PositionCharacteristicDefinition id="${300 + i}"><ToleranceValue>${value}</ToleranceValue><DatumReferenceFrameId>${frameId}</DatumReferenceFrameId></PositionCharacteristicDefinition>`;
    const nominals = (i) =>
      `<PositionCharacteristicNominal id="${400 + i}"><CharacteristicDefinitionId>${300 + i}</CharacteristicDefinitionId></PositionCharacteristicNominal>`;
    const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const m = read(
      'datum-frames.qif',
      qif(`<DatumDefinitions n="${labels.length}">${definitions.join('')}</DatumDefinitions>
  <DatumReferenceFrames n="${frames.length}">${frames.join('')}</DatumReferenceFrames>
  <Features><FeatureNominals n="1"><PlaneFeatureNominal id="150"><Name>PLANE1</Name></PlaneFeatureNominal></FeatureNominals></Features>
  <Characteristics>
    <CharacteristicDefinitions n="${values.length}">${values.map((v, i) => definitionsXml(200 + i, v, i)).join('')}</CharacteristicDefinitions>
    <CharacteristicNominals n="${values.length}">${values.map((_, i) => nominals(i)).join('')}</CharacteristicNominals>
  </Characteristics>`),
    );
    const tolerances = m.pmi.filter((p) => p.kind === 'tolerance').sort((a, b) => a.value[0] - b.value[0]);
    assert.deepEqual(
      tolerances.map((p) => p.datums),
      [
        [[{ name: 'A' }], [{ name: 'B', modifiers: ['maximumMaterial'] }], [{ name: 'C', modifiers: ['leastMaterial', 'reciprocity'] }]],
        [[{ name: 'A' }, { name: 'B', modifiers: ['maximumMaterial'] }], [{ name: 'D' }]],
        [[{ name: 'A', modifiers: ['minorDiameter', 'specificCrossSection', 'plane', 'contactingFeature'], projected: 5 }]],
        [[{ name: 'A' }], [{ name: 'B', modifiers: ['S"X'] }]],
        [
          [{ name: 'A', modifiers: ['basic', 'translation', 'dofX', 'dofY'] }],
          [{ name: 'B', sizeType: 'diameter', size: 3 }],
          [{ name: 'C', modifiers: ['dofTx', 'dofRz'] }],
        ],
        [[
          { name: 'C', modifiers: ['plane'] },
          { name: 'D', modifiers: ['plane'] },
          { name: 'A', modifiers: ['maximumMaterial', 'plane'] },
        ]],
        [[{ name: 'PLANE1', modifiers: ['maximumMaterial'] }], [{ name: 'feature 999' }], [{ name: 'B' }]],
        [[{ name: 'A', sizeType: 'diameter', size: 3, projected: 5 }]],
      ],
    );
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
