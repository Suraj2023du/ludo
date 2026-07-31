/**
 * tests/index.js — suite aggregator.
 *
 * Node 22+ stopped expanding a bare directory passed to `--test`, so this file
 * is the directory entry point: `node --test tests/` resolves to tests/index.js
 * and every imported suite registers itself with node:test.
 *
 * All of these work:
 *   node --test tests/            (uses this file)
 *   node --test tests/*.test.js   (each file in its own process)
 *   npm test
 */

import './rules.test.js';
import './ai.test.js';
import './controller.test.js';
import './meta.test.js';
import './sim.test.js';
import './online.test.js';
import './tournament.test.js';
import './snakes.test.js';
import './ui.test.js';
