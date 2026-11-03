/**
 * CSV as RFC 4180 writes it: comma-separated, fields with commas, quotes or
 * line breaks in double quotes, quotes doubled. Spreadsheets export it this
 * way, and the reader also takes a UTF-8 byte order mark and CRLF lines.
 */

export interface CsvRow {
  /** The line of the file the row starts on, from 1, for error messages. */
  readonly line: number;
  readonly fields: string[];
}

/** The rows of a CSV text. Blank lines are skipped. */
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text;
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const endRow = () => {
    fields.push(field);
    if (fields.length > 1 || fields[0]?.trim()) rows.push({ line: rowLine, fields });
    fields = [];
    field = '';
  };

  for (let i = 0; i < input.length; i++) {
    let char = input.charAt(i);
    // CRLF, LF and a lone CR all end a line.
    if (char === '\r') {
      if (input.charAt(i + 1) === '\n') i++;
      char = '\n';
    }
    if (char === '\n') line++;
    if (quoted) {
      if (char === '"' && input.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else if (char === '\n') {
      endRow();
      rowLine = line;
    } else {
      field += char;
    }
  }
  if (field !== '' || fields.length > 0) endRow();
  return rows;
}

/** CSV text for the rows given, with CRLF line ends as RFC 4180 asks. */
export function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return rows.map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}
