// Filled text for drawn PMI, in one font of our own: osifont (ISO 3098 lettering, GD&T symbols).
#pragma once

#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include <string>
#include <vector>

// Appends the triangles (xyz x3 each) of one line of text: its baseline starts at origin and runs
// along x, letters stand along y, capital letters are height high.
void drawText(const std::u32string& line, const gp_Pnt& origin, const gp_Dir& x, const gp_Dir& y, double height,
              std::vector<float>& triangles);
