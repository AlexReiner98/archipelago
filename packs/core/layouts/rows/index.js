// Layer: metrics. The rows layout (task e_95d3fn63), after SpiderMonkey's iongraph: only the order sets rows; an
// island's items keep the order they were made in; a tree of parts is one block, its parts indented under its head;
// every other link runs on tracks in the streets between rows, packed by the left-edge method; a fixed number of
// straightening passes. Placement and routing read only the model (./model.js until the shared kit's lands). Pure.

import { seaOf } from './sea.js';

/** Every length and count the rows layout works by, each named on the style: rows_* and the flow's sizes it shares. */
export function lengthsOf(sizes, numbers = {}) {
  const need = (set, name) => {
    if (typeof set?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every one the rows layout uses`);
    return set[name];
  };
  return {
    line: need(sizes, 'rows_line_gap'), indent: need(sizes, 'rows_indent'), gap: need(sizes, 'rows_block_gap'), lane: need(sizes, 'rows_lane'),
    track: need(sizes, 'rows_track'), pad: need(sizes, 'rows_street_pad'), street_least: need(sizes, 'rows_street_least'), straight: need(sizes, 'rows_straight'),
    column_most: need(sizes, 'rows_column_most'), island_pad: need(sizes, 'flow_island_pad'), island_name: need(sizes, 'flow_island_name_room'), sea: need(sizes, 'flow_island_sea'),
    straighten: need(numbers, 'rows_straighten'), aspect: need(numbers, 'flow_aspect'),
  };
}

/** The picture of a model: { places, islands, wires, parts, w, h }; `stage(name, snapshot)` is told each step. */
export function rowsOf(model, z, stage = () => {}) {
  return seaOf(model, z, stage);
}
