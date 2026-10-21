// JT (ISO 14306) → XCAF document, tessellated geometry only. Uses TKJT from PyOpenJt (GPL-2.0+).
#pragma once

#include "jt_pmi.h"

#include <TDocStd_Document.hxx>

#include <algorithm>
#include <cctype>
#include <string>
#include <utility>
#include <vector>

// A bullet per name, in alphabetical order without regard to case, for an error message.
inline std::string nameLines(std::vector<std::string> names)
{
  const auto lower = [](std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return char(std::tolower(c)); });
    return s;
  };
  std::sort(names.begin(), names.end(), [&](const std::string& a, const std::string& b) { return lower(a) < lower(b); });
  std::string lines;
  for (const std::string& name : names)
    lines += (lines.empty() ? "• " : "\n• ") + name;
  return lines;
}

// A file a JT assembly keeps parts in, by the name the assembly gives it, and whether it was opened with it.
struct JtReference
{
  std::string name;
  bool        loaded = false;
};

// Files opened together with the assembly: name and bytes.
using JtFiles = std::vector<std::pair<std::string, std::string>>;

// Reads the JT file at path into doc, in mm, and its PMI into pmi: the annotations of the model and
// its parts, and the saved views of the model (or else of the first part that has any). Returns
// the file's length unit as a STEP-style name ("MILLIMETRE", "INCH", ...). Throws
// std::runtime_error when the file cannot be read. The files the assembly references go to references;
// those among files are read into it, and their bytes freed.
std::string readJt(const char*                     path,
                   const Handle(TDocStd_Document)& doc,
                   FilePmi&                        pmi,
                   JtFiles&                        files,
                   std::vector<JtReference>&       references);

// The files the JT file at path references, by name without folders; none when it cannot be read.
std::vector<std::string> jtReferences(const char* path);
