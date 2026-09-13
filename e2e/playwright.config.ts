import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',timeout:120000,expect:{timeout:30000},fullyParallel:false,workers:1,use:{channel:'chrome',baseURL:'http://localhost:5173',viewport:{width:1600,height:1000},trace:'off',screenshot:'off',video:'off'},reporter:[['list'],['json',{outputFile:'artifacts/results.json'}]]});
