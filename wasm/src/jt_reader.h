// JT (ISO 14306) → XCAF document, tessellated geometry only. Uses TKJT from PyOpenJt (GPL-2.0+).
#pragma once

#include "jt_pmi.h"

#include <TDocStd_Document.hxx>

#include <string>

// Reads the JT file at path into doc, in mm, and its PMI into pmi: the annotations of the model and
// its parts, and the saved views of the model (or else of the first part that has any). Returns
// the file's length unit as a STEP-style name ("MILLIMETRE", "INCH", ...). Throws
// std::runtime_error when the file cannot be read.
std::string readJt(const char* path, const Handle(TDocStd_Document)& doc, JtPmi& pmi);
