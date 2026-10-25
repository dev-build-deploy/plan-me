#!/usr/bin/env node

/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Command } from "commander";

const program = new Command();

/**
 * Main entry point for the CLI tool.
 */
program.name("plan-me").description("Deterministic GitHub backlog management for humans and LLMs");

program.parse();
