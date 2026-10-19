// QIF (ISO 23952) → XCAF document: the exact B-rep of the model, its parts and assemblies, and its
// semantic PMI (characteristics, datums, notes) and saved views. Drawn PMI is not read.
#pragma once

#include "file_pmi.h"

#include <TDocStd_Document.hxx>

#include <string>

// Reads the QIF document in bytes into doc, in mm, and its PMI into pmi. Returns the file's length
// unit as a STEP-style name ("MILLIMETRE", "INCH", ...). Throws std::runtime_error when the file
// cannot be read or has no model geometry (a plan, results or rules file).
std::string readQif(const std::string& bytes, const Handle(TDocStd_Document)& doc, FilePmi& pmi);
