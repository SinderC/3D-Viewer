// Base schema SCH_13006 (Parasolid V13). XT data written by Parasolid V14 and later describes its
// node layouts as edits against these (XT Format Reference §2.1.2), so reading it needs them all.
// Generated; do not edit by hand. Each type notes its source:
//   pk      reviewed 13006 layout from parasolid-kit (github.com/monozukuri-ai/parasolid-kit,
//           crates/parasolid-core/src/schema/profiles, MIT License, (c) 2026 parasolid-kit contributors)
//   manual  current layout from the Parasolid XT Format Reference (July 2022), assumed unchanged
//           since V13 (verified only where also marked "seen")
// "seen" marks types that parse to the terminator in the JT samples (Parasolid 17, 25, 31 and 33).
// Fields: node type, field name, type code (§2.1.4), element count (0 scalar, 1 variable, n array).
// clang-format off
// 10: manual
{10, "highest_node_id", 'd', 0}, {10, "attributes_features", 'p', 0}, {10, "attribute_chains", 'p', 0}, {10, "list", 'p', 0}, {10, "lattice", 'p', 0}, {10, "surface", 'p', 0}, {10, "curve", 'p', 0}, {10, "point", 'p', 0}, {10, "mesh", 'p', 0}, {10, "polyline", 'p', 0}, {10, "key", 'p', 0}, {10, "res_size", 'f', 0}, {10, "res_linear", 'f', 0}, {10, "ref_instance", 'p', 0}, {10, "next", 'p', 0}, {10, "previous", 'p', 0}, {10, "state", 'u', 0}, {10, "owner", 'p', 0}, {10, "type", 'u', 0}, {10, "sub_instance", 'p', 0}, {10, "mesh_offset_data", 'p', 0},
// 11: manual
{11, "node_id", 'd', 0}, {11, "attributes_features", 'p', 0}, {11, "type", 'u', 0}, {11, "part", 'p', 0}, {11, "transform", 'p', 0}, {11, "assembly", 'p', 0}, {11, "next_in_part", 'p', 0}, {11, "prev_in_part", 'p', 0}, {11, "next_of_part", 'p', 0}, {11, "prev_of_part", 'p', 0},
// 12: pk, seen
{12, "max_local_id", 'd', 0}, {12, "annotations", 'p', 0}, {12, "attribute_lists", 'p', 0}, {12, "construction_surfaces", 'p', 0}, {12, "construction_curves", 'p', 0}, {12, "construction_points", 'p', 0}, {12, "key_ref", 'p', 0}, {12, "size_precision", 'f', 0}, {12, "linear_precision", 'f', 0}, {12, "instances", 'p', 0}, {12, "next_body", 'p', 0}, {12, "previous_body", 'p', 0}, {12, "storage_state", 'u', 0}, {12, "legacy_owner", 'p', 0}, {12, "body_kind", 'u', 0}, {12, "geometry_state", 'u', 0}, {12, "legacy_shell", 'p', 0}, {12, "boundary_surfaces", 'p', 0}, {12, "boundary_curves", 'p', 0}, {12, "boundary_points", 'p', 0}, {12, "region_head", 'p', 0}, {12, "edge_head", 'p', 0}, {12, "vertex_head", 'p', 0},
// 13: pk, seen
{13, "node_id", 'd', 0}, {13, "attributes_features", 'p', 0}, {13, "body", 'p', 0}, {13, "next", 'p', 0}, {13, "face", 'p', 0}, {13, "edge", 'p', 0}, {13, "vertex", 'p', 0}, {13, "region", 'p', 0}, {13, "front_face", 'p', 0},
// 14: pk, seen
{14, "node_id", 'd', 0}, {14, "attributes_features", 'p', 0}, {14, "tolerance", 'f', 0}, {14, "next", 'p', 0}, {14, "previous", 'p', 0}, {14, "loop", 'p', 0}, {14, "shell", 'p', 0}, {14, "surface", 'p', 0}, {14, "sense", 'c', 0}, {14, "next_on_surface", 'p', 0}, {14, "previous_on_surface", 'p', 0}, {14, "next_front", 'p', 0}, {14, "previous_front", 'p', 0}, {14, "front_shell", 'p', 0},
// 15: pk, seen
{15, "node_id", 'd', 0}, {15, "attributes_features", 'p', 0}, {15, "halfedge", 'p', 0}, {15, "face", 'p', 0}, {15, "next", 'p', 0},
// 16: pk, seen
{16, "node_id", 'd', 0}, {16, "attributes_features", 'p', 0}, {16, "tolerance", 'f', 0}, {16, "halfedge", 'p', 0}, {16, "previous", 'p', 0}, {16, "next", 'p', 0}, {16, "curve", 'p', 0}, {16, "next_on_curve", 'p', 0}, {16, "previous_on_curve", 'p', 0}, {16, "owner", 'p', 0},
// 17: pk, seen
{17, "attributes_features", 'p', 0}, {17, "loop", 'p', 0}, {17, "forward", 'p', 0}, {17, "backward", 'p', 0}, {17, "vertex", 'p', 0}, {17, "other", 'p', 0}, {17, "edge", 'p', 0}, {17, "curve", 'p', 0}, {17, "next_at_vx", 'p', 0}, {17, "sense", 'c', 0},
// 18: pk, seen
{18, "node_id", 'd', 0}, {18, "attributes_features", 'p', 0}, {18, "halfedge", 'p', 0}, {18, "previous", 'p', 0}, {18, "next", 'p', 0}, {18, "point", 'p', 0}, {18, "tolerance", 'f', 0}, {18, "owner", 'p', 0},
// 19: pk, seen
{19, "node_id", 'd', 0}, {19, "attributes_features", 'p', 0}, {19, "body", 'p', 0}, {19, "next", 'p', 0}, {19, "previous", 'p', 0}, {19, "shell", 'p', 0}, {19, "type", 'c', 0},
// 29: pk, seen
{29, "node_id", 'd', 0}, {29, "attributes_features", 'p', 0}, {29, "owner", 'p', 0}, {29, "next", 'p', 0}, {29, "previous", 'p', 0}, {29, "pvec", 'v', 0},
// 30: pk, seen
{30, "node_id", 'd', 0}, {30, "attributes_features", 'p', 0}, {30, "owner", 'p', 0}, {30, "next", 'p', 0}, {30, "previous", 'p', 0}, {30, "geometric_owner", 'p', 0}, {30, "sense", 'c', 0}, {30, "pvec", 'v', 0}, {30, "direction", 'v', 0},
// 31: pk, seen
{31, "node_id", 'd', 0}, {31, "attributes_features", 'p', 0}, {31, "owner", 'p', 0}, {31, "next", 'p', 0}, {31, "previous", 'p', 0}, {31, "geometric_owner", 'p', 0}, {31, "sense", 'c', 0}, {31, "centre", 'v', 0}, {31, "normal", 'v', 0}, {31, "x_axis", 'v', 0}, {31, "radius", 'f', 0},
// 32: pk, seen
{32, "node_id", 'd', 0}, {32, "attributes_features", 'p', 0}, {32, "owner", 'p', 0}, {32, "next", 'p', 0}, {32, "previous", 'p', 0}, {32, "geometric_owner", 'p', 0}, {32, "sense", 'c', 0}, {32, "centre", 'v', 0}, {32, "normal", 'v', 0}, {32, "x_axis", 'v', 0}, {32, "major_radius", 'f', 0}, {32, "minor_radius", 'f', 0},
// 38: pk, seen
{38, "node_id", 'd', 0}, {38, "attributes_features", 'p', 0}, {38, "owner", 'p', 0}, {38, "next", 'p', 0}, {38, "previous", 'p', 0}, {38, "geometric_owner", 'p', 0}, {38, "sense", 'c', 0}, {38, "surface", 'p', 2}, {38, "chart", 'p', 0}, {38, "start", 'p', 0}, {38, "end", 'p', 0},
// 40: pk, seen
{40, "base_parameter", 'f', 0}, {40, "base_scale", 'f', 0}, {40, "chart_count", 'd', 0}, {40, "chordal_error", 'f', 0}, {40, "angular_error", 'f', 0}, {40, "parameter_error", 'f', 2}, {40, "hvec", 'h', 1},
// 41: pk, seen
{41, "type", 'c', 0}, {41, "hvec", 'h', 1},
// 45: pk, seen
{45, "vertices", 'f', 1},
// 50: pk, seen
{50, "node_id", 'd', 0}, {50, "attributes_features", 'p', 0}, {50, "owner", 'p', 0}, {50, "next", 'p', 0}, {50, "previous", 'p', 0}, {50, "geometric_owner", 'p', 0}, {50, "sense", 'c', 0}, {50, "pvec", 'v', 0}, {50, "normal", 'v', 0}, {50, "x_axis", 'v', 0},
// 51: pk, seen
{51, "node_id", 'd', 0}, {51, "attributes_features", 'p', 0}, {51, "owner", 'p', 0}, {51, "next", 'p', 0}, {51, "previous", 'p', 0}, {51, "geometric_owner", 'p', 0}, {51, "sense", 'c', 0}, {51, "pvec", 'v', 0}, {51, "axis", 'v', 0}, {51, "radius", 'f', 0}, {51, "x_axis", 'v', 0},
// 52: pk, seen
{52, "node_id", 'd', 0}, {52, "attributes_features", 'p', 0}, {52, "owner", 'p', 0}, {52, "next", 'p', 0}, {52, "previous", 'p', 0}, {52, "geometric_owner", 'p', 0}, {52, "sense", 'c', 0}, {52, "pvec", 'v', 0}, {52, "axis", 'v', 0}, {52, "radius", 'f', 0}, {52, "sin_half_angle", 'f', 0}, {52, "cos_half_angle", 'f', 0}, {52, "x_axis", 'v', 0},
// 53: pk
{53, "node_id", 'd', 0}, {53, "attributes_features", 'p', 0}, {53, "owner", 'p', 0}, {53, "next", 'p', 0}, {53, "previous", 'p', 0}, {53, "geometric_owner", 'p', 0}, {53, "sense", 'c', 0}, {53, "centre", 'v', 0}, {53, "radius", 'f', 0}, {53, "axis", 'v', 0}, {53, "x_axis", 'v', 0},
// 54: pk, seen
{54, "node_id", 'd', 0}, {54, "attributes_features", 'p', 0}, {54, "owner", 'p', 0}, {54, "next", 'p', 0}, {54, "previous", 'p', 0}, {54, "geometric_owner", 'p', 0}, {54, "sense", 'c', 0}, {54, "centre", 'v', 0}, {54, "axis", 'v', 0}, {54, "major_radius", 'f', 0}, {54, "minor_radius", 'f', 0}, {54, "x_axis", 'v', 0},
// 56: pk
{56, "local_id", 'd', 0}, {56, "annotations", 'p', 0}, {56, "owner_ref", 'p', 0}, {56, "next_surface", 'p', 0}, {56, "previous_surface", 'p', 0}, {56, "indirect_owner", 'p', 0}, {56, "orientation", 'c', 0}, {56, "blend_kind", 'c', 0}, {56, "support_surfaces", 'p', 2}, {56, "spine_curve", 'p', 0}, {56, "offsets", 'f', 2}, {56, "weights", 'f', 2}, {56, "boundary_surfaces", 'p', 2}, {56, "start_limit", 'p', 0}, {56, "end_limit", 'p', 0},
// 59: pk
{59, "node_id", 'd', 0}, {59, "attributes_features", 'p', 0}, {59, "owner", 'p', 0}, {59, "next", 'p', 0}, {59, "previous", 'p', 0}, {59, "geometric_owner", 'p', 0}, {59, "sense", 'c', 0}, {59, "boundary", 'n', 0}, {59, "blend", 'p', 0},
// 60: pk
{60, "node_id", 'd', 0}, {60, "attributes_features", 'p', 0}, {60, "owner", 'p', 0}, {60, "next", 'p', 0}, {60, "previous", 'p', 0}, {60, "geometric_owner", 'p', 0}, {60, "sense", 'c', 0}, {60, "check", 'c', 0}, {60, "true_offset", 'l', 0}, {60, "surface", 'p', 0}, {60, "offset", 'f', 0}, {60, "scale", 'f', 0},
// 67: manual, seen
{67, "node_id", 'd', 0}, {67, "attributes_features", 'p', 0}, {67, "owner", 'p', 0}, {67, "next", 'p', 0}, {67, "previous", 'p', 0}, {67, "geometric_owner", 'p', 0}, {67, "sense", 'c', 0}, {67, "section", 'p', 0}, {67, "sweep", 'v', 0}, {67, "scale", 'f', 0},
// 68: pk
{68, "node_id", 'd', 0}, {68, "attributes_features", 'p', 0}, {68, "owner", 'p', 0}, {68, "next", 'p', 0}, {68, "previous", 'p', 0}, {68, "geometric_owner", 'p', 0}, {68, "sense", 'c', 0}, {68, "profile", 'p', 0}, {68, "base", 'v', 0}, {68, "axis", 'v', 0}, {68, "start", 'v', 0}, {68, "end", 'v', 0}, {68, "start_param", 'f', 0}, {68, "end_param", 'f', 0}, {68, "x_axis", 'v', 0}, {68, "scale", 'f', 0},
// 70: pk, seen
{70, "local_id", 'd', 0}, {70, "owner_ref", 'p', 0}, {70, "next_list", 'p', 0}, {70, "previous_list", 'p', 0}, {70, "entry_kind", 'd', 0}, {70, "entry_count", 'd', 0}, {70, "block_capacity", 'd', 0}, {70, "entry_size", 'd', 0}, {70, "block_head", 'p', 0}, {70, "cursor_block", 'p', 0}, {70, "cursor_index", 'd', 0}, {70, "transmission_flag", 'l', 0},
// 74: pk, seen
{74, "used_count", 'd', 0}, {74, "next_block", 'p', 0}, {74, "entries", 'p', 1},
// 79: pk, seen
{79, "string", 'c', 1},
// 80: pk, seen
{80, "next_definition", 'p', 0}, {80, "identifier_ref", 'p', 0}, {80, "kind_id", 'd', 0}, {80, "event_actions", 'u', 8}, {80, "field_labels", 'p', 0}, {80, "allowed_owners", 'l', 14}, {80, "value_kinds", 'u', 1},
// 81: pk, seen
{81, "node_id", 'd', 0}, {81, "definition", 'p', 0}, {81, "owner", 'p', 0}, {81, "next", 'p', 0}, {81, "previous", 'p', 0}, {81, "next_of_type", 'p', 0}, {81, "previous_of_type", 'p', 0}, {81, "fields", 'p', 1},
// 82: pk, seen
{82, "values", 'd', 1},
// 83: pk, seen
{83, "values", 'f', 1},
// 84: pk, seen
{84, "values", 'c', 1},
// 85: manual
{85, "values", 'v', 1},
// 86: manual
{86, "values", 'v', 1},
// 87: manual
{87, "values", 'v', 1},
// 88: manual
{88, "values", 't', 1},
// 89: manual
{89, "values", 'v', 1},
// 90: manual, seen
{90, "node_id", 'd', 0}, {90, "attributes_features", 'p', 0}, {90, "owner", 'p', 0}, {90, "next", 'p', 0}, {90, "previous", 'p', 0}, {90, "type", 'u', 0}, {90, "first_member", 'p', 0},
// 91: manual, seen
{91, "dummy_node_id", 'd', 0}, {91, "owning_feature", 'p', 0}, {91, "owner", 'p', 0}, {91, "next", 'p', 0}, {91, "previous", 'p', 0}, {91, "next_member", 'p', 0}, {91, "previous_member", 'p', 0},
// 98: pk, seen
{98, "values", 'w', 1},
// 99: manual, seen
{99, "names", 'p', 1},
// 100: manual
{100, "node_id", 'd', 0}, {100, "owner", 'p', 0}, {100, "next", 'p', 0}, {100, "previous", 'p', 0}, {100, "translation_vector", 'v', 0}, {100, "scale", 'f', 0}, {100, "flag", 'd', 0}, {100, "perspective_vector", 'v', 0}, {100, "precision", 'p', 0},
// 101: manual
{101, "assembly", 'p', 0}, {101, "attribute", 'p', 0}, {101, "body", 'p', 0}, {101, "transform", 'p', 0}, {101, "lattice", 'p', 0}, {101, "surface", 'p', 0}, {101, "curve", 'p', 0}, {101, "point", 'p', 0}, {101, "mesh", 'p', 0}, {101, "polyline", 'p', 0}, {101, "alive", 'l', 0}, {101, "attrib_def", 'p', 0}, {101, "attdef_list", 'p', 0}, {101, "highest_id", 'd', 0}, {101, "current_id", 'd', 0}, {101, "index_map", 'p', 0}, {101, "schema_embedding_map", 'p', 0}, {101, "mesh_offset_data", 'p', 0},
// 102: manual
{102, "string", 'c', 1},
// 120: manual
{120, "node_id", 'd', 0}, {120, "attributes_features", 'p', 0}, {120, "owner", 'p', 0}, {120, "next", 'p', 0}, {120, "previous", 'p', 0}, {120, "geometric_owner", 'p', 0}, {120, "sense", 'c', 0}, {120, "type", 'c', 0}, {120, "data", 'p', 0}, {120, "tf", 'p', 0},
// 121: manual
{121, "geom_type", 'd', 0}, {121, "real_array", 'p', 0}, {121, "int_array", 'p', 0},
// 122: manual
{122, "key", 'p', 0}, {122, "real_array", 'p', 0}, {122, "int_array", 'p', 0},
// 124: pk, seen
{124, "node_id", 'd', 0}, {124, "attributes_features", 'p', 0}, {124, "owner", 'p', 0}, {124, "next", 'p', 0}, {124, "previous", 'p', 0}, {124, "geometric_owner", 'p', 0}, {124, "sense", 'c', 0}, {124, "nurbs", 'p', 0}, {124, "data", 'p', 0},
// 125: pk, seen
{125, "original_uint", 'i', 0}, {125, "original_vint", 'i', 0}, {125, "extended_uint", 'i', 0}, {125, "extended_vint", 'i', 0}, {125, "self_int", 'u', 0}, {125, "original_u_start", 'c', 0}, {125, "original_u_end", 'c', 0}, {125, "original_v_start", 'c', 0}, {125, "original_v_end", 'c', 0}, {125, "extended_u_start", 'c', 0}, {125, "extended_u_end", 'c', 0}, {125, "extended_v_start", 'c', 0}, {125, "extended_v_end", 'c', 0}, {125, "analytic_form_type", 'c', 0}, {125, "swept_form_type", 'c', 0}, {125, "spun_form_type", 'c', 0}, {125, "blend_form_type", 'c', 0}, {125, "analytic_form", 'p', 0}, {125, "swept_form", 'p', 0}, {125, "spun_form", 'p', 0}, {125, "blend_form", 'p', 0},
// 126: pk, seen
{126, "u_periodic", 'l', 0}, {126, "v_periodic", 'l', 0}, {126, "u_degree", 'n', 0}, {126, "v_degree", 'n', 0}, {126, "n_u_vertices", 'd', 0}, {126, "n_v_vertices", 'd', 0}, {126, "u_knot_type", 'u', 0}, {126, "v_knot_type", 'u', 0}, {126, "n_u_knots", 'd', 0}, {126, "n_v_knots", 'd', 0}, {126, "rational", 'l', 0}, {126, "u_closed", 'l', 0}, {126, "v_closed", 'l', 0}, {126, "surface_form", 'u', 0}, {126, "vertex_dim", 'n', 0}, {126, "bspline_vertices", 'p', 0}, {126, "u_knot_mult", 'p', 0}, {126, "v_knot_mult", 'p', 0}, {126, "u_knots", 'p', 0}, {126, "v_knots", 'p', 0},
// 127: pk, seen
{127, "mult", 'n', 1},
// 128: pk, seen
{128, "knots", 'f', 1},
// 130: manual
{130, "attributes_features", 'p', 0}, {130, "owner", 'p', 0}, {130, "next", 'p', 0}, {130, "previous", 'p', 0}, {130, "geometric_owner", 'p', 0}, {130, "sense", 'c', 0}, {130, "type", 'c', 0}, {130, "data", 'p', 0}, {130, "tf", 'p', 0},
// 133: pk, seen
{133, "node_id", 'd', 0}, {133, "attributes_features", 'p', 0}, {133, "owner", 'p', 0}, {133, "next", 'p', 0}, {133, "previous", 'p', 0}, {133, "geometric_owner", 'p', 0}, {133, "sense", 'c', 0}, {133, "basis_curve", 'p', 0}, {133, "point_1", 'v', 0}, {133, "point_2", 'v', 0}, {133, "parm_1", 'f', 0}, {133, "parm_2", 'f', 0},
// 134: pk, seen
{134, "node_id", 'd', 0}, {134, "attributes_features", 'p', 0}, {134, "owner", 'p', 0}, {134, "next", 'p', 0}, {134, "previous", 'p', 0}, {134, "geometric_owner", 'p', 0}, {134, "sense", 'c', 0}, {134, "nurbs", 'p', 0}, {134, "data", 'p', 0},
// 135: pk, seen
{135, "self_intersection_state", 'u', 0}, {135, "analytic_form", 'p', 0},
// 136: pk, seen
{136, "degree", 'n', 0}, {136, "n_vertices", 'd', 0}, {136, "vertex_dim", 'n', 0}, {136, "n_knots", 'd', 0}, {136, "knot_type", 'u', 0}, {136, "periodic", 'l', 0}, {136, "closed", 'l', 0}, {136, "rational", 'l', 0}, {136, "curve_form", 'u', 0}, {136, "bspline_vertices", 'p', 0}, {136, "knot_mult", 'p', 0}, {136, "knots", 'p', 0},
// 137: pk
{137, "node_id", 'd', 0}, {137, "attributes_features", 'p', 0}, {137, "owner", 'p', 0}, {137, "next", 'p', 0}, {137, "previous", 'p', 0}, {137, "geometric_owner", 'p', 0}, {137, "sense", 'c', 0}, {137, "surface", 'p', 0}, {137, "b_curve", 'p', 0}, {137, "original", 'p', 0}, {137, "tolerance_to_original", 'f', 0},
// 141: pk, seen
{141, "owner", 'p', 0}, {141, "next", 'p', 0}, {141, "previous", 'p', 0}, {141, "shared_geometry", 'p', 0},
// 163: manual, seen
{163, "axis_pt", 'v', 0}, {163, "axis_dir", 'v', 0}, {163, "hand", 'c', 0}, {163, "turns", 'i', 0}, {163, "pitch", 'f', 0}, {163, "gap", 'f', 0}, {163, "tol", 'f', 0},
// 184: manual, seen
{184, "axis_pt", 'v', 0}, {184, "axis_dir", 'v', 0}, {184, "point", 'v', 0}, {184, "hand", 'c', 0}, {184, "turns", 'i', 0}, {184, "pitch", 'f', 0}, {184, "tol", 'f', 0},
// clang-format on
