import React from 'react';
import {createRoot} from 'react-dom/client';
import {SandpackProvider,SandpackPreview} from '@codesandbox/sandpack-react';
import {main,app} from './app.mjs';
const root=createRoot(document.getElementById('root')!);
Object.assign(window,{benchReady:true,startBench(){(window as any).benchStart=performance.now();root.render(<SandpackProvider template="react" files={{'/index.js':main,'/App.js':app(false),'/public/index.html':'<!doctype html><html><body><div id="root"></div></body></html>'}} customSetup={{dependencies:{react:'19.3.0','react-dom':'19.3.0'},entry:'/index.js'}}><SandpackPreview style={{height:800}} showOpenInCodeSandbox={false}/></SandpackProvider>);}});
