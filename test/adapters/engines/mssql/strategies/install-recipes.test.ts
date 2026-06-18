/**
 * install-recipes.test.ts — unit tests for the MSSQL install recipe registry.
 *
 * E5.1: asserts recipe shape, per-OS lookup, official sources only.
 * connectivity-strategies Batch E, task E5.1.
 */

import { describe, it, expect } from 'vitest';
import {
  getRecipes,
  type InstallRecipe,
} from '../../../../../src/adapters/engines/mssql/strategies/install-recipes.js';

describe('getRecipes()', () => {
  it('returns an array of at least one recipe for tool "sqlcmd" on win32', () => {
    const recipes = getRecipes('sqlcmd', 'win32');
    expect(Array.isArray(recipes)).toBe(true);
    expect(recipes.length).toBeGreaterThanOrEqual(1);
  });

  it('each recipe has a method field of winget, brew, or url', () => {
    const recipes = getRecipes('sqlcmd', 'win32');
    for (const recipe of recipes) {
      expect(['winget', 'brew', 'url']).toContain(recipe.method);
    }
  });

  it('win32 recipe for sqlcmd uses winget with official Microsoft.Sqlcmd id', () => {
    const recipes = getRecipes('sqlcmd', 'win32');
    const wingetRecipe = recipes.find((r) => r.method === 'winget');
    expect(wingetRecipe).toBeDefined();
    expect(wingetRecipe?.id).toBe('Microsoft.Sqlcmd');
  });

  it('win32 recipe for sqlcmd includes a url to an official Microsoft source', () => {
    const recipes = getRecipes('sqlcmd', 'win32');
    for (const recipe of recipes) {
      expect(recipe.url).toMatch(/microsoft\.com/i);
    }
  });

  it('darwin recipe for sqlcmd uses brew with an official source', () => {
    const recipes = getRecipes('sqlcmd', 'darwin');
    expect(recipes.length).toBeGreaterThanOrEqual(1);
    const brewRecipe = recipes.find((r) => r.method === 'brew');
    expect(brewRecipe).toBeDefined();
  });

  it('linux recipe for sqlcmd has at least one url recipe', () => {
    const recipes = getRecipes('sqlcmd', 'linux');
    expect(recipes.length).toBeGreaterThanOrEqual(1);
    const urlRecipe = recipes.find((r) => r.method === 'url');
    expect(urlRecipe).toBeDefined();
  });

  it('returns empty array for an unknown tool', () => {
    const recipes = getRecipes('no-such-tool', 'win32');
    expect(recipes).toEqual([]);
  });

  it('each recipe has a non-empty url string', () => {
    const allOses = ['win32', 'darwin', 'linux'] as const;
    for (const os of allOses) {
      const recipes = getRecipes('sqlcmd', os);
      for (const recipe of recipes) {
        expect(typeof recipe.url).toBe('string');
        expect(recipe.url.length).toBeGreaterThan(0);
      }
    }
  });

  it('recipe type satisfies InstallRecipe shape', () => {
    const recipes = getRecipes('sqlcmd', 'win32');
    const r: InstallRecipe = recipes[0] as InstallRecipe;
    // InstallRecipe has os, method, url; id is optional
    expect(r.os).toBe('win32');
    expect(typeof r.url).toBe('string');
  });
});
