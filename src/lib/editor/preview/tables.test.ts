import { describe, it, expect } from 'vitest';
import {
  parseCellsWithPositions,
  tableToGrid,
  type CellInfo,
  type RowData,
  type TableContext,
} from './tables.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal RowData for use in TableContext fixtures. */
function makeRow(
  overrides: Partial<RowData> & { cells: CellInfo[] }
): RowData {
  return {
    from: 0,
    to: 10,
    text: '',
    isDelimiter: false,
    isHeader: false,
    rowIndex: 0,
    ...overrides,
  };
}

/** Build a minimal TableContext. */
function makeCtx(rows: RowData[]): TableContext {
  return {
    rows,
    colWidths: [],
    colCount: 3,
    nodeFrom: 0,
    nodeTo: 100,
  };
}

// ---------------------------------------------------------------------------
// parseCellsWithPositions
// ---------------------------------------------------------------------------

describe('parseCellsWithPositions', () => {
  // -- Normal row -----------------------------------------------------------

  it('NormalRow_ThreeCells_ReturnsThreeCells', () => {
    const text = '| Alice | Engineer | Active |';
    const cells = parseCellsWithPositions(text, 0);

    expect(cells).toHaveLength(3);
    expect(cells[0].text).toBe('Alice');
    expect(cells[1].text).toBe('Engineer');
    expect(cells[2].text).toBe('Active');
  });

  it('NormalRow_ThreeCells_ReturnsCorrectFromPositions', () => {
    // text:  | Alice | Engineer | Active |
    // idx:   0123456789...
    // lineFrom = 0
    // After leading '|', cell 0 starts at index 1: ' Alice '
    //   raw = ' Alice ', trimmed = 'Alice', leadSpaces = 1
    //   from = 0 + 1 + 1 = 2, to = 2 + 5 = 7
    const text = '| Alice | Engineer | Active |';
    const cells = parseCellsWithPositions(text, 0);

    expect(cells[0].from).toBe(2);
    expect(cells[0].to).toBe(7);
  });

  it('NormalRow_ThreeCells_ReturnsCorrectToPositions', () => {
    const text = '| Alice | Engineer | Active |';
    const cells = parseCellsWithPositions(text, 0);

    // '| Alice | Engineer | Active |'
    //  0       8          19
    // The '|' closing cell 0 is at index 8; cellStart for cell 1 = 9.
    // raw = ' Engineer ' (indices 9–18), leadSpaces = 1
    // from = 0 + 9 + 1 = 10, to = 10 + 8 ('Engineer') = 18
    expect(cells[1].from).toBe(10);
    expect(cells[1].to).toBe(18);
  });

  it('NormalRow_LineFromOffset_PositionsAreAbsolute', () => {
    const text = '| Alice | Bob |';
    const lineFrom = 50;
    const cells = parseCellsWithPositions(text, lineFrom);

    // Cell 0: raw = ' Alice ', leadSpaces = 1, cellStart = 1
    // from = 50 + 1 + 1 = 52
    expect(cells[0].from).toBe(52);
    expect(cells[0].to).toBe(57); // 52 + 5 ('Alice')
  });

  // -- Empty cells ----------------------------------------------------------

  it('EmptyCells_ThreeEmpty_ReturnsThreeCells', () => {
    const text = '|   |   |   |';
    const cells = parseCellsWithPositions(text, 0);

    expect(cells).toHaveLength(3);
  });

  it('EmptyCells_EmptyText_TextIsEmptyString', () => {
    const text = '|   |   |   |';
    const cells = parseCellsWithPositions(text, 0);

    for (const cell of cells) {
      expect(cell.text).toBe('');
    }
  });

  it('EmptyCells_FromEqualsTo_PointsInsideCell', () => {
    const text = '|   |   |   |';
    // Cell 0: raw = '   ', cellStart = 1, midpoint = 0 + 1 + floor(3/2) = 2
    const cells = parseCellsWithPositions(text, 0);

    expect(cells[0].from).toBe(cells[0].to);
  });

  it('EmptyCells_Midpoint_CalculatedCorrectly', () => {
    const text = '|   |   |   |';
    // cellStart for cell 0 = 1 (after leading '|')
    // raw = '   ' (3 chars), midpoint = 0 + 1 + floor(3/2) = 2
    const cells = parseCellsWithPositions(text, 0);

    expect(cells[0].from).toBe(2);
  });

  // -- Row with dashes (data row, NOT delimiter) ----------------------------

  it('DashRow_CellsContainDashes_ParsedAsNormalCells', () => {
    const text = '| - | - | - |';
    const cells = parseCellsWithPositions(text, 0);

    expect(cells).toHaveLength(3);
    expect(cells[0].text).toBe('-');
    expect(cells[1].text).toBe('-');
    expect(cells[2].text).toBe('-');
  });

  it('DashRow_DelimiterStyle_ParsedAsNormalCells', () => {
    // A realistic GFM delimiter row — parseCellsWithPositions should treat it
    // identically to any other row; delimiter classification is done by position.
    const text = '| --- | --- | --- |';
    const cells = parseCellsWithPositions(text, 0);

    expect(cells).toHaveLength(3);
    expect(cells[0].text).toBe('---');
  });

  it('DashRow_AlignedDelimiter_ParsedAsNormalCells', () => {
    const text = '| :---: | ---: | :--- |';
    const cells = parseCellsWithPositions(text, 0);

    expect(cells).toHaveLength(3);
    expect(cells[0].text).toBe(':---:');
    expect(cells[1].text).toBe('---:');
    expect(cells[2].text).toBe(':---');
  });

  // -- Escaped pipe ---------------------------------------------------------

  it('EscapedPipe_InCell_NotSplitOnEscapedPipe', () => {
    // The parser skips '|' when preceded by '\'
    // text: | foo\|bar | baz |
    // The '\|' should not be treated as a cell separator.
    const text = '| foo\\|bar | baz |';
    const cells = parseCellsWithPositions(text, 0);

    // Depending on implementation: the escaped pipe is not a boundary.
    // parseCellsWithPositions checks text[i-1] !== '\\'
    expect(cells.length).toBeGreaterThanOrEqual(1);
    // 'baz' must always appear as its own cell
    const bazCell = cells.find(c => c.text === 'baz');
    expect(bazCell).toBeDefined();
  });

  it('EscapedPipe_FirstCell_ContainsLiteralBackslashPipe', () => {
    const text = '| foo\\|bar | baz |';
    const cells = parseCellsWithPositions(text, 0);

    // First cell raw segment is 'foo\\|bar' which trims to 'foo\\|bar'
    // because the '|' after '\\' is skipped as a separator.
    // Cell text should include the escaped sequence as-is.
    expect(cells[0].text).toBe('foo\\|bar');
  });

  // -- Leading/trailing whitespace variations --------------------------------

  it('Whitespace_ExtraSpaces_TextIsTrimmed', () => {
    const text = '|  Alice   |  Bob  |';
    const cells = parseCellsWithPositions(text, 0);

    expect(cells[0].text).toBe('Alice');
    expect(cells[1].text).toBe('Bob');
  });

  it('Whitespace_NoSpaceAroundPipes_ParsedCorrectly', () => {
    const text = '|Alice|Bob|';
    const cells = parseCellsWithPositions(text, 0);

    expect(cells).toHaveLength(2);
    expect(cells[0].text).toBe('Alice');
    expect(cells[1].text).toBe('Bob');
  });

  it('Whitespace_SingleSpaceCell_TreatedAsEmpty', () => {
    // A single space trims to '' so it should be treated as an empty cell.
    const text = '| |';
    const cells = parseCellsWithPositions(text, 0);

    expect(cells).toHaveLength(1);
    expect(cells[0].text).toBe('');
    expect(cells[0].from).toBe(cells[0].to);
  });

  // -- Single-column table --------------------------------------------------

  it('SingleColumn_OneCell_ParsedCorrectly', () => {
    const text = '| Value |';
    const cells = parseCellsWithPositions(text, 0);

    expect(cells).toHaveLength(1);
    expect(cells[0].text).toBe('Value');
  });

  // -- Row without leading pipe ---------------------------------------------

  it('NoLeadingPipe_SkipsUntilFirstPipe_ThenParsesNormally', () => {
    // The function scans past any non-'|' chars before the first pipe.
    const text = 'Alice | Bob | Carol |';
    const cells = parseCellsWithPositions(text, 0);

    // After skipping 'Alice ' the first pipe is at index 6, then Bob and Carol
    expect(cells.length).toBeGreaterThanOrEqual(1);
    expect(cells[cells.length - 1].text).toBe('Carol');
  });
});

// ---------------------------------------------------------------------------
// tableToGrid
// ---------------------------------------------------------------------------

describe('tableToGrid', () => {
  it('FiltersDelimiterRow_OnlyHeaderAndDataRows', () => {
    const headerCells: CellInfo[] = [
      { text: 'Name', from: 1, to: 5 },
      { text: 'Role', from: 7, to: 11 },
    ];
    const delimCells: CellInfo[] = [
      { text: '---', from: 20, to: 23 },
      { text: '---', from: 25, to: 28 },
    ];
    const dataCells: CellInfo[] = [
      { text: 'Alice', from: 40, to: 45 },
      { text: 'Engineer', from: 47, to: 55 },
    ];

    const rows: RowData[] = [
      makeRow({ cells: headerCells, isHeader: true, rowIndex: 0 }),
      makeRow({ cells: delimCells, isDelimiter: true, rowIndex: -1 }),
      makeRow({ cells: dataCells, isHeader: false, rowIndex: 1 }),
    ];
    const ctx = makeCtx(rows);
    const grid = tableToGrid(ctx);

    expect(grid).toHaveLength(2);
  });

  it('FiltersDelimiterRow_GridDoesNotContainDelimiterContent', () => {
    const headerCells: CellInfo[] = [{ text: 'Name', from: 1, to: 5 }];
    const delimCells: CellInfo[] = [{ text: '---', from: 10, to: 13 }];
    const dataCells: CellInfo[] = [{ text: 'Alice', from: 20, to: 25 }];

    const rows: RowData[] = [
      makeRow({ cells: headerCells, isHeader: true, rowIndex: 0 }),
      makeRow({ cells: delimCells, isDelimiter: true, rowIndex: -1 }),
      makeRow({ cells: dataCells, rowIndex: 1 }),
    ];
    const ctx = makeCtx(rows);
    const grid = tableToGrid(ctx);

    const allText = grid.flat();
    expect(allText).not.toContain('---');
  });

  it('HeaderRow_IsFirstRowInGrid', () => {
    const headerCells: CellInfo[] = [
      { text: 'Name', from: 1, to: 5 },
      { text: 'Role', from: 7, to: 11 },
    ];
    const delimCells: CellInfo[] = [
      { text: '---', from: 20, to: 23 },
      { text: '---', from: 25, to: 28 },
    ];

    const rows: RowData[] = [
      makeRow({ cells: headerCells, isHeader: true, rowIndex: 0 }),
      makeRow({ cells: delimCells, isDelimiter: true, rowIndex: -1 }),
    ];
    const ctx = makeCtx(rows);
    const grid = tableToGrid(ctx);

    expect(grid[0]).toEqual(['Name', 'Role']);
  });

  it('MultipleDataRows_PreservesOrder', () => {
    const header: CellInfo[] = [{ text: 'Name', from: 0, to: 4 }];
    const delim: CellInfo[] = [{ text: '---', from: 10, to: 13 }];
    const row1: CellInfo[] = [{ text: 'Alice', from: 20, to: 25 }];
    const row2: CellInfo[] = [{ text: 'Bob', from: 30, to: 33 }];
    const row3: CellInfo[] = [{ text: 'Carol', from: 40, to: 45 }];

    const rows: RowData[] = [
      makeRow({ cells: header, isHeader: true, rowIndex: 0 }),
      makeRow({ cells: delim, isDelimiter: true, rowIndex: -1 }),
      makeRow({ cells: row1, rowIndex: 1 }),
      makeRow({ cells: row2, rowIndex: 2 }),
      makeRow({ cells: row3, rowIndex: 3 }),
    ];
    const ctx = makeCtx(rows);
    const grid = tableToGrid(ctx);

    expect(grid).toHaveLength(4);
    expect(grid[1]).toEqual(['Alice']);
    expect(grid[2]).toEqual(['Bob']);
    expect(grid[3]).toEqual(['Carol']);
  });

  it('CellText_ExtractedFromCellInfoText', () => {
    const headerCells: CellInfo[] = [
      { text: 'Name', from: 1, to: 5 },
      { text: 'Status', from: 7, to: 13 },
    ];
    const dataCells: CellInfo[] = [
      { text: 'Alice', from: 20, to: 25 },
      { text: 'Active', from: 27, to: 33 },
    ];
    const rows: RowData[] = [
      makeRow({ cells: headerCells, isHeader: true, rowIndex: 0 }),
      makeRow({ cells: dataCells, rowIndex: 1 }),
    ];
    const ctx = makeCtx(rows);
    const grid = tableToGrid(ctx);

    expect(grid[0]).toEqual(['Name', 'Status']);
    expect(grid[1]).toEqual(['Alice', 'Active']);
  });

  it('EmptyTable_OnlyHeaderAndDelimiter_ReturnsOnlyHeaderRow', () => {
    const header: CellInfo[] = [{ text: 'Col', from: 0, to: 3 }];
    const delim: CellInfo[] = [{ text: '---', from: 10, to: 13 }];

    const rows: RowData[] = [
      makeRow({ cells: header, isHeader: true, rowIndex: 0 }),
      makeRow({ cells: delim, isDelimiter: true, rowIndex: -1 }),
    ];
    const ctx = makeCtx(rows);
    const grid = tableToGrid(ctx);

    expect(grid).toHaveLength(1);
    expect(grid[0]).toEqual(['Col']);
  });

  it('NoDelimiterRow_AllRowsIncluded', () => {
    // Edge case: context with no delimiter row at all
    const row1: CellInfo[] = [{ text: 'A', from: 0, to: 1 }];
    const row2: CellInfo[] = [{ text: 'B', from: 10, to: 11 }];
    const rows: RowData[] = [
      makeRow({ cells: row1, isHeader: true, rowIndex: 0 }),
      makeRow({ cells: row2, rowIndex: 1 }),
    ];
    const ctx = makeCtx(rows);
    const grid = tableToGrid(ctx);

    expect(grid).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Delimiter detection: position-based, not content-based
// ---------------------------------------------------------------------------

describe('delimiter detection (position-based)', () => {
  // These tests document the intended classification rule:
  // "only the 2nd line (startLine + 1) is the delimiter — never by content."
  //
  // The decorateTable function sets:
  //   isDelimiter = (i === startLine.number + 1)
  //
  // We verify that parseCellsWithPositions itself is content-agnostic —
  // it never refuses to parse or changes behaviour based on dash content.

  it('DashOnlyRow_ParsedSameAsNormalRow', () => {
    // A row that LOOKS like a GFM delimiter should parse identically to a
    // row with real data — delimiter status is not parseCellsWithPositions' concern.
    const delim = '| --- | --- | --- |';
    const normal = '| foo | bar | baz |';

    const delimCells = parseCellsWithPositions(delim, 0);
    const normalCells = parseCellsWithPositions(normal, 0);

    expect(delimCells).toHaveLength(normalCells.length);
  });

  it('ThirdRow_DashContent_NotTreatedAsDelimiterByTableToGrid', () => {
    // A dash-content row at position 3 (rowIndex 2) is NOT a delimiter.
    // isDelimiter must be false for it, so tableToGrid must include it.
    const header: CellInfo[] = [{ text: 'Name', from: 0, to: 4 }];
    const delim: CellInfo[] = [{ text: '---', from: 10, to: 13 }];
    const data1: CellInfo[] = [{ text: 'Alice', from: 20, to: 25 }];
    const dashData: CellInfo[] = [{ text: '---', from: 30, to: 33 }];

    const rows: RowData[] = [
      makeRow({ cells: header, isHeader: true, rowIndex: 0 }),
      makeRow({ cells: delim, isDelimiter: true, rowIndex: -1 }),
      makeRow({ cells: data1, rowIndex: 1 }),
      // Row with dashes at position 3 — isDelimiter must be false
      makeRow({ cells: dashData, isDelimiter: false, rowIndex: 2 }),
    ];
    const ctx = makeCtx(rows);
    const grid = tableToGrid(ctx);

    // grid: header, data1, dashData — 3 rows
    expect(grid).toHaveLength(3);
    expect(grid[2]).toEqual(['---']);
  });

  it('SecondRow_AnyContent_MarkedAsDelimiter', () => {
    // Even a row with "real" content at position 2 would be the delimiter
    // according to the position-based rule.  tableToGrid filters it out.
    const header: CellInfo[] = [{ text: 'Name', from: 0, to: 4 }];
    const secondRow: CellInfo[] = [{ text: 'Alice', from: 10, to: 15 }];
    const data: CellInfo[] = [{ text: 'Bob', from: 20, to: 23 }];

    const rows: RowData[] = [
      makeRow({ cells: header, isHeader: true, rowIndex: 0 }),
      makeRow({ cells: secondRow, isDelimiter: true, rowIndex: -1 }),
      makeRow({ cells: data, rowIndex: 1 }),
    ];
    const ctx = makeCtx(rows);
    const grid = tableToGrid(ctx);

    expect(grid).toHaveLength(2);
    // 'Alice' (second row, treated as delimiter) must NOT appear in the grid
    expect(grid.flat()).not.toContain('Alice');
  });
});
