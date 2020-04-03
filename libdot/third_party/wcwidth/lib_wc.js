// Copyright (c) 2014 The Chromium OS Authors. All rights reserved.
// Use of lib.wc source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

/**
 * @fileoverview
 * This JavaScript library is ported from the wcwidth.js module of node.js.
 * The original implementation can be found at:
 * https://npmjs.org/package/wcwidth.js
 */

/**
 * JavaScript porting of Markus Kuhn's wcwidth() implementation
 *
 * The following explanation comes from the original C implementation:
 *
 * This is an implementation of wcwidth() and wcswidth() (defined in
 * IEEE Std 1002.1-2001) for Unicode.
 *
 * https://www.opengroup.org/onlinepubs/007904975/functions/wcwidth.html
 * https://www.opengroup.org/onlinepubs/007904975/functions/wcswidth.html
 *
 * In fixed-width output devices, Latin characters all occupy a single
 * "cell" position of equal width, whereas ideographic CJK characters
 * occupy two such cells. Interoperability between terminal-line
 * applications and (teletype-style) character terminals using the
 * UTF-8 encoding requires agreement on which character should advance
 * the cursor by how many cell positions. No established formal
 * standards exist at present on which Unicode character shall occupy
 * how many cell positions on character terminals. These routines are
 * a first attempt of defining such behavior based on simple rules
 * applied to data provided by the Unicode Consortium.
 *
 * For some graphical characters, the Unicode standard explicitly
 * defines a character-cell width via the definition of the East Asian
 * FullWidth (F), Wide (W), Half-width (H), and Narrow (Na) classes.
 * In all these cases, there is no ambiguity about which width a
 * terminal shall use. For characters in the East Asian Ambiguous (A)
 * class, the width choice depends purely on a preference of backward
 * compatibility with either historic CJK or Western practice.
 * Choosing single-width for these characters is easy to justify as
 * the appropriate long-term solution, as the CJK practice of
 * displaying these characters as double-width comes from historic
 * implementation simplicity (8-bit encoded characters were displayed
 * single-width and 16-bit ones double-width, even for Greek,
 * Cyrillic, etc.) and not any typographic considerations.
 *
 * Much less clear is the choice of width for the Not East Asian
 * (Neutral) class. Existing practice does not dictate a width for any
 * of these characters. It would nevertheless make sense
 * typographically to allocate two character cells to characters such
 * as for instance EM SPACE or VOLUME INTEGRAL, which cannot be
 * represented adequately with a single-width glyph. The following
 * routines at present merely assign a single-cell width to all
 * neutral characters, in the interest of simplicity. This is not
 * entirely satisfactory and should be reconsidered before
 * establishing a formal standard in lib.wc area. At the moment, the
 * decision which Not East Asian (Neutral) characters should be
 * represented by double-width glyphs cannot yet be answered by
 * applying a simple rule from the Unicode database content. Setting
 * up a proper standard for the behavior of UTF-8 character terminals
 * will require a careful analysis not only of each Unicode character,
 * but also of each presentation form, something the author of these
 * routines has avoided to do so far.
 *
 * https://www.unicode.org/unicode/reports/tr11/
 *
 * Markus Kuhn -- 2007-05-26 (Unicode 5.0)
 *
 * Permission to use, copy, modify, and distribute lib.wc software
 * for any purpose and without fee is hereby granted. The author
 * disclaims all warranties with regard to lib.wc software.
 *
 * Latest version: https://www.cl.cam.ac.uk/~mgk25/ucs/wcwidth.c
 */

/**
 * The following function defines the column width of an ISO 10646 character
 * as follows:
 *
 *  - The null character (U+0000) has a column width of 0.
 *  - Other C0/C1 control characters and DEL will lead to a return value of -1.
 *  - Non-spacing and enclosing combining characters (general category code Mn
 *    or Me in the Unicode database) have a column width of 0.
 *  - SOFT HYPHEN (U+00AD) has a column width of 1.
 *  - Other format characters (general category code Cf in the Unicode database)
 *    and ZERO WIDTH SPACE (U+200B) have a column width of 0.
 *  - Hangul Jamo medial vowels and final consonants (U+1160-U+11FF) have a
 *    column width of 0.
 *  - Spacing characters in the East Asian Wide (W) or East Asian Full-width (F)
 *    category as defined in Unicode Technical Report #11 have a column width of
 *    2.
 *  - East Asian Ambiguous characters are taken into account if
 *    regardCjkAmbiguous flag is enabled. They have a column width of 2.
 *  - All remaining characters (including all printable ISO 8859-1 and WGL4
 *    characters, Unicode control characters, etc.) have a column width of 1.
 *
 * This implementation assumes that characters are encoded in ISO 10646.
 */

lib.wc = {};

// Width of a nul character.
lib.wc.nulWidth = 0;

// Width of a control character.
lib.wc.controlWidth = 0;

// Flag whether to consider East Asian Ambiguous characters.
lib.wc.regardCjkAmbiguous = false;

// Width of an East Asian Ambiguous character.
lib.wc.cjkAmbiguousWidth = 2;

// Sorted list of non-overlapping intervals of non-spacing characters
// generated by the `./ranges.py` helper.
lib.wc.combining = [
    [0x00ad, 0x00ad], [0x0300, 0x036f], [0x0483, 0x0489],
    [0x0591, 0x05bd], [0x05bf, 0x05bf], [0x05c1, 0x05c2],
    [0x05c4, 0x05c5], [0x05c7, 0x05c7], [0x0610, 0x061a],
    [0x061c, 0x061c], [0x064b, 0x065f], [0x0670, 0x0670],
    [0x06d6, 0x06dc], [0x06df, 0x06e4], [0x06e7, 0x06e8],
    [0x06ea, 0x06ed], [0x0711, 0x0711], [0x0730, 0x074a],
    [0x07a6, 0x07b0], [0x07eb, 0x07f3], [0x07fd, 0x07fd],
    [0x0816, 0x0819], [0x081b, 0x0823], [0x0825, 0x0827],
    [0x0829, 0x082d], [0x0859, 0x085b], [0x08d3, 0x08e1],
    [0x08e3, 0x0902], [0x093a, 0x093a], [0x093c, 0x093c],
    [0x0941, 0x0948], [0x094d, 0x094d], [0x0951, 0x0957],
    [0x0962, 0x0963], [0x0981, 0x0981], [0x09bc, 0x09bc],
    [0x09c1, 0x09c4], [0x09cd, 0x09cd], [0x09e2, 0x09e3],
    [0x09fe, 0x09fe], [0x0a01, 0x0a02], [0x0a3c, 0x0a3c],
    [0x0a41, 0x0a42], [0x0a47, 0x0a48], [0x0a4b, 0x0a4d],
    [0x0a51, 0x0a51], [0x0a70, 0x0a71], [0x0a75, 0x0a75],
    [0x0a81, 0x0a82], [0x0abc, 0x0abc], [0x0ac1, 0x0ac5],
    [0x0ac7, 0x0ac8], [0x0acd, 0x0acd], [0x0ae2, 0x0ae3],
    [0x0afa, 0x0aff], [0x0b01, 0x0b01], [0x0b3c, 0x0b3c],
    [0x0b3f, 0x0b3f], [0x0b41, 0x0b44], [0x0b4d, 0x0b4d],
    [0x0b55, 0x0b56], [0x0b62, 0x0b63], [0x0b82, 0x0b82],
    [0x0bc0, 0x0bc0], [0x0bcd, 0x0bcd], [0x0c00, 0x0c00],
    [0x0c04, 0x0c04], [0x0c3e, 0x0c40], [0x0c46, 0x0c48],
    [0x0c4a, 0x0c4d], [0x0c55, 0x0c56], [0x0c62, 0x0c63],
    [0x0c81, 0x0c81], [0x0cbc, 0x0cbc], [0x0cbf, 0x0cbf],
    [0x0cc6, 0x0cc6], [0x0ccc, 0x0ccd], [0x0ce2, 0x0ce3],
    [0x0d00, 0x0d01], [0x0d3b, 0x0d3c], [0x0d41, 0x0d44],
    [0x0d4d, 0x0d4d], [0x0d62, 0x0d63], [0x0d81, 0x0d81],
    [0x0dca, 0x0dca], [0x0dd2, 0x0dd4], [0x0dd6, 0x0dd6],
    [0x0e31, 0x0e31], [0x0e34, 0x0e3a], [0x0e47, 0x0e4e],
    [0x0eb1, 0x0eb1], [0x0eb4, 0x0ebc], [0x0ec8, 0x0ecd],
    [0x0f18, 0x0f19], [0x0f35, 0x0f35], [0x0f37, 0x0f37],
    [0x0f39, 0x0f39], [0x0f71, 0x0f7e], [0x0f80, 0x0f84],
    [0x0f86, 0x0f87], [0x0f8d, 0x0f97], [0x0f99, 0x0fbc],
    [0x0fc6, 0x0fc6], [0x102d, 0x1030], [0x1032, 0x1037],
    [0x1039, 0x103a], [0x103d, 0x103e], [0x1058, 0x1059],
    [0x105e, 0x1060], [0x1071, 0x1074], [0x1082, 0x1082],
    [0x1085, 0x1086], [0x108d, 0x108d], [0x109d, 0x109d],
    [0x1160, 0x11ff], [0x135d, 0x135f], [0x1712, 0x1714],
    [0x1732, 0x1734], [0x1752, 0x1753], [0x1772, 0x1773],
    [0x17b4, 0x17b5], [0x17b7, 0x17bd], [0x17c6, 0x17c6],
    [0x17c9, 0x17d3], [0x17dd, 0x17dd], [0x180b, 0x180e],
    [0x1885, 0x1886], [0x18a9, 0x18a9], [0x1920, 0x1922],
    [0x1927, 0x1928], [0x1932, 0x1932], [0x1939, 0x193b],
    [0x1a17, 0x1a18], [0x1a1b, 0x1a1b], [0x1a56, 0x1a56],
    [0x1a58, 0x1a5e], [0x1a60, 0x1a60], [0x1a62, 0x1a62],
    [0x1a65, 0x1a6c], [0x1a73, 0x1a7c], [0x1a7f, 0x1a7f],
    [0x1ab0, 0x1ac0], [0x1b00, 0x1b03], [0x1b34, 0x1b34],
    [0x1b36, 0x1b3a], [0x1b3c, 0x1b3c], [0x1b42, 0x1b42],
    [0x1b6b, 0x1b73], [0x1b80, 0x1b81], [0x1ba2, 0x1ba5],
    [0x1ba8, 0x1ba9], [0x1bab, 0x1bad], [0x1be6, 0x1be6],
    [0x1be8, 0x1be9], [0x1bed, 0x1bed], [0x1bef, 0x1bf1],
    [0x1c2c, 0x1c33], [0x1c36, 0x1c37], [0x1cd0, 0x1cd2],
    [0x1cd4, 0x1ce0], [0x1ce2, 0x1ce8], [0x1ced, 0x1ced],
    [0x1cf4, 0x1cf4], [0x1cf8, 0x1cf9], [0x1dc0, 0x1df9],
    [0x1dfb, 0x1dff], [0x200b, 0x200f], [0x202a, 0x202e],
    [0x2060, 0x2064], [0x2066, 0x206f], [0x20d0, 0x20f0],
    [0x2cef, 0x2cf1], [0x2d7f, 0x2d7f], [0x2de0, 0x2dff],
    [0x302a, 0x302d], [0x3099, 0x309a], [0xa66f, 0xa672],
    [0xa674, 0xa67d], [0xa69e, 0xa69f], [0xa6f0, 0xa6f1],
    [0xa802, 0xa802], [0xa806, 0xa806], [0xa80b, 0xa80b],
    [0xa825, 0xa826], [0xa82c, 0xa82c], [0xa8c4, 0xa8c5],
    [0xa8e0, 0xa8f1], [0xa8ff, 0xa8ff], [0xa926, 0xa92d],
    [0xa947, 0xa951], [0xa980, 0xa982], [0xa9b3, 0xa9b3],
    [0xa9b6, 0xa9b9], [0xa9bc, 0xa9bd], [0xa9e5, 0xa9e5],
    [0xaa29, 0xaa2e], [0xaa31, 0xaa32], [0xaa35, 0xaa36],
    [0xaa43, 0xaa43], [0xaa4c, 0xaa4c], [0xaa7c, 0xaa7c],
    [0xaab0, 0xaab0], [0xaab2, 0xaab4], [0xaab7, 0xaab8],
    [0xaabe, 0xaabf], [0xaac1, 0xaac1], [0xaaec, 0xaaed],
    [0xaaf6, 0xaaf6], [0xabe5, 0xabe5], [0xabe8, 0xabe8],
    [0xabed, 0xabed], [0xfb1e, 0xfb1e], [0xfe00, 0xfe0f],
    [0xfe20, 0xfe2f], [0xfeff, 0xfeff], [0xfff9, 0xfffb],
    [0x101fd, 0x101fd], [0x102e0, 0x102e0], [0x10376, 0x1037a],
    [0x10a01, 0x10a03], [0x10a05, 0x10a06], [0x10a0c, 0x10a0f],
    [0x10a38, 0x10a3a], [0x10a3f, 0x10a3f], [0x10ae5, 0x10ae6],
    [0x10d24, 0x10d27], [0x10eab, 0x10eac], [0x10f46, 0x10f50],
    [0x11001, 0x11001], [0x11038, 0x11046], [0x1107f, 0x11081],
    [0x110b3, 0x110b6], [0x110b9, 0x110ba], [0x11100, 0x11102],
    [0x11127, 0x1112b], [0x1112d, 0x11134], [0x11173, 0x11173],
    [0x11180, 0x11181], [0x111b6, 0x111be], [0x111c9, 0x111cc],
    [0x111cf, 0x111cf], [0x1122f, 0x11231], [0x11234, 0x11234],
    [0x11236, 0x11237], [0x1123e, 0x1123e], [0x112df, 0x112df],
    [0x112e3, 0x112ea], [0x11300, 0x11301], [0x1133b, 0x1133c],
    [0x11340, 0x11340], [0x11366, 0x1136c], [0x11370, 0x11374],
    [0x11438, 0x1143f], [0x11442, 0x11444], [0x11446, 0x11446],
    [0x1145e, 0x1145e], [0x114b3, 0x114b8], [0x114ba, 0x114ba],
    [0x114bf, 0x114c0], [0x114c2, 0x114c3], [0x115b2, 0x115b5],
    [0x115bc, 0x115bd], [0x115bf, 0x115c0], [0x115dc, 0x115dd],
    [0x11633, 0x1163a], [0x1163d, 0x1163d], [0x1163f, 0x11640],
    [0x116ab, 0x116ab], [0x116ad, 0x116ad], [0x116b0, 0x116b5],
    [0x116b7, 0x116b7], [0x1171d, 0x1171f], [0x11722, 0x11725],
    [0x11727, 0x1172b], [0x1182f, 0x11837], [0x11839, 0x1183a],
    [0x1193b, 0x1193c], [0x1193e, 0x1193e], [0x11943, 0x11943],
    [0x119d4, 0x119d7], [0x119da, 0x119db], [0x119e0, 0x119e0],
    [0x11a01, 0x11a0a], [0x11a33, 0x11a38], [0x11a3b, 0x11a3e],
    [0x11a47, 0x11a47], [0x11a51, 0x11a56], [0x11a59, 0x11a5b],
    [0x11a8a, 0x11a96], [0x11a98, 0x11a99], [0x11c30, 0x11c36],
    [0x11c38, 0x11c3d], [0x11c3f, 0x11c3f], [0x11c92, 0x11ca7],
    [0x11caa, 0x11cb0], [0x11cb2, 0x11cb3], [0x11cb5, 0x11cb6],
    [0x11d31, 0x11d36], [0x11d3a, 0x11d3a], [0x11d3c, 0x11d3d],
    [0x11d3f, 0x11d45], [0x11d47, 0x11d47], [0x11d90, 0x11d91],
    [0x11d95, 0x11d95], [0x11d97, 0x11d97], [0x11ef3, 0x11ef4],
    [0x13430, 0x13438], [0x16af0, 0x16af4], [0x16b30, 0x16b36],
    [0x16f4f, 0x16f4f], [0x16f8f, 0x16f92], [0x16fe4, 0x16fe4],
    [0x1bc9d, 0x1bc9e], [0x1bca0, 0x1bca3], [0x1d167, 0x1d169],
    [0x1d173, 0x1d182], [0x1d185, 0x1d18b], [0x1d1aa, 0x1d1ad],
    [0x1d242, 0x1d244], [0x1da00, 0x1da36], [0x1da3b, 0x1da6c],
    [0x1da75, 0x1da75], [0x1da84, 0x1da84], [0x1da9b, 0x1da9f],
    [0x1daa1, 0x1daaf], [0x1e000, 0x1e006], [0x1e008, 0x1e018],
    [0x1e01b, 0x1e021], [0x1e023, 0x1e024], [0x1e026, 0x1e02a],
    [0x1e130, 0x1e136], [0x1e2ec, 0x1e2ef], [0x1e8d0, 0x1e8d6],
    [0x1e944, 0x1e94a], [0xe0001, 0xe0001], [0xe0020, 0xe007f],
    [0xe0100, 0xe01ef],
];

// Sorted list of non-overlapping intervals of East Asian Ambiguous characters
// generated by the `./ranges.py` helper.
lib.wc.ambiguous = [
    [0x00a1, 0x00a1], [0x00a4, 0x00a4], [0x00a7, 0x00a8],
    [0x00aa, 0x00aa], [0x00ad, 0x00ae], [0x00b0, 0x00b4],
    [0x00b6, 0x00ba], [0x00bc, 0x00bf], [0x00c6, 0x00c6],
    [0x00d0, 0x00d0], [0x00d7, 0x00d8], [0x00de, 0x00e1],
    [0x00e6, 0x00e6], [0x00e8, 0x00ea], [0x00ec, 0x00ed],
    [0x00f0, 0x00f0], [0x00f2, 0x00f3], [0x00f7, 0x00fa],
    [0x00fc, 0x00fc], [0x00fe, 0x00fe], [0x0101, 0x0101],
    [0x0111, 0x0111], [0x0113, 0x0113], [0x011b, 0x011b],
    [0x0126, 0x0127], [0x012b, 0x012b], [0x0131, 0x0133],
    [0x0138, 0x0138], [0x013f, 0x0142], [0x0144, 0x0144],
    [0x0148, 0x014b], [0x014d, 0x014d], [0x0152, 0x0153],
    [0x0166, 0x0167], [0x016b, 0x016b], [0x01ce, 0x01ce],
    [0x01d0, 0x01d0], [0x01d2, 0x01d2], [0x01d4, 0x01d4],
    [0x01d6, 0x01d6], [0x01d8, 0x01d8], [0x01da, 0x01da],
    [0x01dc, 0x01dc], [0x0251, 0x0251], [0x0261, 0x0261],
    [0x02c4, 0x02c4], [0x02c7, 0x02c7], [0x02c9, 0x02cb],
    [0x02cd, 0x02cd], [0x02d0, 0x02d0], [0x02d8, 0x02db],
    [0x02dd, 0x02dd], [0x02df, 0x02df], [0x0300, 0x036f],
    [0x0391, 0x03a1], [0x03a3, 0x03a9], [0x03b1, 0x03c1],
    [0x03c3, 0x03c9], [0x0401, 0x0401], [0x0410, 0x044f],
    [0x0451, 0x0451], [0x1100, 0x115f], [0x2010, 0x2010],
    [0x2013, 0x2016], [0x2018, 0x2019], [0x201c, 0x201d],
    [0x2020, 0x2022], [0x2024, 0x2027], [0x2030, 0x2030],
    [0x2032, 0x2033], [0x2035, 0x2035], [0x203b, 0x203b],
    [0x203e, 0x203e], [0x2074, 0x2074], [0x207f, 0x207f],
    [0x2081, 0x2084], [0x20ac, 0x20ac], [0x2103, 0x2103],
    [0x2105, 0x2105], [0x2109, 0x2109], [0x2113, 0x2113],
    [0x2116, 0x2116], [0x2121, 0x2122], [0x2126, 0x2126],
    [0x212b, 0x212b], [0x2153, 0x2154], [0x215b, 0x215e],
    [0x2160, 0x216b], [0x2170, 0x2179], [0x2189, 0x2189],
    [0x2190, 0x2199], [0x21b8, 0x21b9], [0x21d2, 0x21d2],
    [0x21d4, 0x21d4], [0x21e7, 0x21e7], [0x2200, 0x2200],
    [0x2202, 0x2203], [0x2207, 0x2208], [0x220b, 0x220b],
    [0x220f, 0x220f], [0x2211, 0x2211], [0x2215, 0x2215],
    [0x221a, 0x221a], [0x221d, 0x2220], [0x2223, 0x2223],
    [0x2225, 0x2225], [0x2227, 0x222c], [0x222e, 0x222e],
    [0x2234, 0x2237], [0x223c, 0x223d], [0x2248, 0x2248],
    [0x224c, 0x224c], [0x2252, 0x2252], [0x2260, 0x2261],
    [0x2264, 0x2267], [0x226a, 0x226b], [0x226e, 0x226f],
    [0x2282, 0x2283], [0x2286, 0x2287], [0x2295, 0x2295],
    [0x2299, 0x2299], [0x22a5, 0x22a5], [0x22bf, 0x22bf],
    [0x2312, 0x2312], [0x231a, 0x231b], [0x2329, 0x232a],
    [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
    [0x2460, 0x24e9], [0x24eb, 0x254b], [0x2550, 0x2573],
    [0x2580, 0x258f], [0x2592, 0x2595], [0x25a0, 0x25a1],
    [0x25a3, 0x25a9], [0x25b2, 0x25b3], [0x25b6, 0x25b7],
    [0x25bc, 0x25bd], [0x25c0, 0x25c1], [0x25c6, 0x25c8],
    [0x25cb, 0x25cb], [0x25ce, 0x25d1], [0x25e2, 0x25e5],
    [0x25ef, 0x25ef], [0x25fd, 0x25fe], [0x2605, 0x2606],
    [0x2609, 0x2609], [0x260e, 0x260f], [0x2614, 0x2615],
    [0x261c, 0x261c], [0x261e, 0x261e], [0x2640, 0x2640],
    [0x2642, 0x2642], [0x2648, 0x2653], [0x2660, 0x2661],
    [0x2663, 0x2665], [0x2667, 0x266a], [0x266c, 0x266d],
    [0x266f, 0x266f], [0x267f, 0x267f], [0x2693, 0x2693],
    [0x269e, 0x269f], [0x26a1, 0x26a1], [0x26aa, 0x26ab],
    [0x26bd, 0x26bf], [0x26c4, 0x26e1], [0x26e3, 0x26e3],
    [0x26e8, 0x26ff], [0x2705, 0x2705], [0x270a, 0x270b],
    [0x2728, 0x2728], [0x273d, 0x273d], [0x274c, 0x274c],
    [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757],
    [0x2776, 0x277f], [0x2795, 0x2797], [0x27b0, 0x27b0],
    [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50],
    [0x2b55, 0x2b59], [0x2e80, 0x2fdf], [0x2ff0, 0x303e],
    [0x3040, 0x4dbf], [0x4e00, 0xa4cf], [0xa960, 0xa97f],
    [0xac00, 0xd7a3], [0xe000, 0xfaff], [0xfe00, 0xfe19],
    [0xfe30, 0xfe6f], [0xff01, 0xff60], [0xffe0, 0xffe6],
    [0xfffd, 0xfffd], [0x16fe0, 0x16fe4], [0x16ff0, 0x16ff1],
    [0x17000, 0x18cd5], [0x18d00, 0x18d08], [0x1b000, 0x1b12f],
    [0x1b150, 0x1b152], [0x1b164, 0x1b167], [0x1b170, 0x1b2ff],
    [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f100, 0x1f10a],
    [0x1f110, 0x1f12d], [0x1f130, 0x1f169], [0x1f170, 0x1f1ac],
    [0x1f200, 0x1f202], [0x1f210, 0x1f23b], [0x1f240, 0x1f248],
    [0x1f250, 0x1f251], [0x1f260, 0x1f265], [0x1f300, 0x1f320],
    [0x1f32d, 0x1f335], [0x1f337, 0x1f37c], [0x1f37e, 0x1f393],
    [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0],
    [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440],
    [0x1f442, 0x1f4fc], [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e],
    [0x1f550, 0x1f567], [0x1f57a, 0x1f57a], [0x1f595, 0x1f596],
    [0x1f5a4, 0x1f5a4], [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5],
    [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d7],
    [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc], [0x1f7e0, 0x1f7eb],
    [0x1f90c, 0x1f93a], [0x1f93c, 0x1f945], [0x1f947, 0x1f978],
    [0x1f97a, 0x1f9cb], [0x1f9cd, 0x1f9ff], [0x1fa70, 0x1fa74],
    [0x1fa78, 0x1fa7a], [0x1fa80, 0x1fa86], [0x1fa90, 0x1faa8],
    [0x1fab0, 0x1fab6], [0x1fac0, 0x1fac2], [0x1fad0, 0x1fad6],
    [0x20000, 0x2fffd], [0x30000, 0x3fffd], [0xe0100, 0xe01ef],
    [0xf0000, 0xffffd], [0x100000, 0x10fffd],
];

// Sorted list of non-overlapping intervals of East Asian Unambiguous characters
// generated by the `./ranges.py` helper.
lib.wc.unambiguous = [
    [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a],
    [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
    [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653],
    [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
    [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
    [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
    [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
    [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
    [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e],
    [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
    [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c],
    [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x2fdf],
    [0x2ff0, 0x303e], [0x3040, 0x3247], [0x3250, 0x4dbf],
    [0x4e00, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
    [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
    [0xff01, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4],
    [0x16ff0, 0x16ff1], [0x17000, 0x18cd5], [0x18d00, 0x18d08],
    [0x1b000, 0x1b12f], [0x1b150, 0x1b152], [0x1b164, 0x1b167],
    [0x1b170, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf],
    [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f202],
    [0x1f210, 0x1f23b], [0x1f240, 0x1f248], [0x1f250, 0x1f251],
    [0x1f260, 0x1f265], [0x1f300, 0x1f320], [0x1f32d, 0x1f335],
    [0x1f337, 0x1f37c], [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca],
    [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0], [0x1f3f4, 0x1f3f4],
    [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440], [0x1f442, 0x1f4fc],
    [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567],
    [0x1f57a, 0x1f57a], [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4],
    [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5], [0x1f6cc, 0x1f6cc],
    [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d7], [0x1f6eb, 0x1f6ec],
    [0x1f6f4, 0x1f6fc], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f93a],
    [0x1f93c, 0x1f945], [0x1f947, 0x1f978], [0x1f97a, 0x1f9cb],
    [0x1f9cd, 0x1f9ff], [0x1fa70, 0x1fa74], [0x1fa78, 0x1fa7a],
    [0x1fa80, 0x1fa86], [0x1fa90, 0x1faa8], [0x1fab0, 0x1fab6],
    [0x1fac0, 0x1fac2], [0x1fad0, 0x1fad6], [0x20000, 0x2fffd],
    [0x30000, 0x3fffd],
];

/**
 * Binary search to check if the given unicode character is in the table.
 *
 * @param {number} ucs A unicode character code.
 * @param {!Object} table A sorted list of internals to match against.
 * @return {boolean} True if the given character is in the table.
 */
lib.wc.binaryTableSearch_ = function(ucs, table) {
  var min = 0, max = table.length - 1;
  var mid;

  if (ucs < table[min][0] || ucs > table[max][1])
    return false;
  while (max >= min) {
    mid = Math.floor((min + max) / 2);
    if (ucs > table[mid][1]) {
      min = mid + 1;
    } else if (ucs < table[mid][0]) {
      max = mid - 1;
    } else {
      return true;
    }
  }

  return false;
};

/**
 * Binary search to check if the given unicode character is a space character.
 *
 * @param {number} ucs A unicode character code.
 * @return {boolean} True if the given character is a space character; false
 *     otherwise.
 */
lib.wc.isSpace = function(ucs) {
  return lib.wc.binaryTableSearch_(ucs, lib.wc.combining);
};

/**
 * Auxiliary function for checking if the given unicode character is a East
 * Asian Ambiguous character.
 *
 * @param {number} ucs A unicode character code.
 * @return {boolean} True if the given character is a East Asian Ambiguous
 *     character.
 */
lib.wc.isCjkAmbiguous = function(ucs) {
  return lib.wc.binaryTableSearch_(ucs, lib.wc.ambiguous);
};

/**
 * Determine the column width of the given character.
 *
 * @param {number} ucs A unicode character code.
 * @return {number} The column width of the given character.
 */
lib.wc.charWidth = function(ucs) {
  if (lib.wc.regardCjkAmbiguous) {
    return lib.wc.charWidthRegardAmbiguous(ucs);
  } else {
    return lib.wc.charWidthDisregardAmbiguous(ucs);
  }
};

/**
 * Determine the column width of the given character without considering East
 * Asian Ambiguous characters.
 *
 * @param {number} ucs A unicode character code.
 * @return {number} The column width of the given character.
 */
lib.wc.charWidthDisregardAmbiguous = function(ucs) {
  // Optimize for ASCII characters.
  if (ucs < 0x7f) {
    if (ucs >= 0x20)
      return 1;
    else if (ucs == 0)
      return lib.wc.nulWidth;
    else /* if (ucs < 0x20) */
      return lib.wc.controlWidth;
  }

  // Test for 8-bit control characters.
  if (ucs < 0xa0)
    return lib.wc.controlWidth;

  // Binary search in table of non-spacing characters.
  if (lib.wc.isSpace(ucs))
    return 0;

  // Binary search in table of wide characters.
  return lib.wc.binaryTableSearch_(ucs, lib.wc.unambiguous) ? 2 : 1;
};

/**
 * Determine the column width of the given character considering East Asian
 * Ambiguous characters.
 *
 * @param {number} ucs A unicode character code.
 * @return {number} The column width of the given character.
 */
lib.wc.charWidthRegardAmbiguous = function(ucs) {
  if (lib.wc.isCjkAmbiguous(ucs))
    return lib.wc.cjkAmbiguousWidth;

  return lib.wc.charWidthDisregardAmbiguous(ucs);
};

/**
 * Determine the column width of the given string.
 *
 * @param {string} str A string.
 * @return {number} The column width of the given string.
 */
lib.wc.strWidth = function(str) {
  var width, rv = 0;

  for (var i = 0; i < str.length;) {
    var codePoint = str.codePointAt(i);
    width = lib.wc.charWidth(codePoint);
    if (width < 0)
      return -1;
    rv += width;
    i += (codePoint <= 0xffff) ? 1 : 2;
  }

  return rv;
};

/**
 * Get the substring at the given column offset of the given column width.
 *
 * @param {string} str The string to get substring from.
 * @param {number} start The starting column offset to get substring.
 * @param {number=} opt_width The column width of the substring.
 * @return {string} The substring.
 */
lib.wc.substr = function(str, start, opt_width) {
  var startIndex = 0;
  var endIndex, width;

  // Fun edge case: Normally we associate zero width codepoints (like combining
  // characters) with the previous codepoint, so we skip any leading ones while
  // including trailing ones.  However, if there are zero width codepoints at
  // the start of the string, and the substring starts at 0, lets include them
  // in the result.  This also makes for a simple optimization for a common
  // request.
  if (start) {
    for (width = 0; startIndex < str.length;) {
      const codePoint = str.codePointAt(startIndex);
      width += lib.wc.charWidth(codePoint);
      if (width > start)
        break;
      startIndex += (codePoint <= 0xffff) ? 1 : 2;
    }
  }

  if (opt_width != undefined) {
    for (endIndex = startIndex, width = 0; endIndex < str.length;) {
      const codePoint = str.codePointAt(endIndex);
      width += lib.wc.charWidth(codePoint);
      if (width > opt_width)
        break;
      endIndex += (codePoint <= 0xffff) ? 1 : 2;
    }
    return str.substring(startIndex, endIndex);
  }

  return str.substr(startIndex);
};

/**
 * Get substring at the given start and end column offset.
 *
 * @param {string} str The string to get substring from.
 * @param {number} start The starting column offset.
 * @param {number} end The ending column offset.
 * @return {string} The substring.
 */
lib.wc.substring = function(str, start, end) {
  return lib.wc.substr(str, start, end - start);
};
