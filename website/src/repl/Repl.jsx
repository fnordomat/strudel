/*
Repl.jsx - <short description TODO>
Copyright (C) 2022 Strudel contributors - see <https://github.com/tidalcycles/strudel/blob/main/repl/src/App.js>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { code2hash, getDrawContext, logger, silence } from '@strudel.cycles/core';
import cx from '@src/cx.mjs';
import { transpiler } from '@strudel.cycles/transpiler';
import { getAudioContext, initAudioOnFirstClick, webaudioOutput } from '@strudel.cycles/webaudio';
import { defaultAudioDeviceName } from '../settings.mjs';
import { getAudioDevices, setAudioDevice } from './util.mjs';
import { StrudelMirror, defaultSettings } from '@strudel/codemirror';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initUserCode,
  setActivePattern,
  setLatestCode,
  settingsMap,
  updateUserCode,
  useSettings,
} from '../settings.mjs';
import { Header } from './Header';
import Loader from './Loader';
import { Panel } from './panel/Panel';
import { useStore } from '@nanostores/react';
import { prebake } from './prebake.mjs';
import { getRandomTune, initCode, loadModules, shareCode, ReplContext } from './util.mjs';
import PlayCircleIcon from '@heroicons/react/20/solid/PlayCircleIcon';
import './Repl.css';

const { code: randomTune, name } = getRandomTune();

const { latestCode } = settingsMap.get();

let modulesLoading, presets, drawContext, clearCanvas, isIframe;
if (typeof window !== 'undefined') {
  initAudioOnFirstClick();
  modulesLoading = loadModules();
  presets = prebake();
  drawContext = getDrawContext();
  clearCanvas = () => drawContext.clearRect(0, 0, drawContext.canvas.height, drawContext.canvas.width);
  isIframe = window.location !== window.parent.location;
}

export function Repl({ embedded = false }) {
  const isEmbedded = embedded || isIframe;
  const { panelPosition, isZen } = useSettings();

  const init = useCallback(() => {
    const drawTime = [-2, 2];
    const drawContext = getDrawContext();
    const onDraw = (haps, time, frame, painters) => {
      painters.length && drawContext.clearRect(0, 0, drawContext.canvas.width * 2, drawContext.canvas.height * 2);
      painters?.forEach((painter) => {
        // ctx time haps drawTime paintOptions
        painter(drawContext, time, haps, drawTime, { clear: false });
      });
    };
    const editor = new StrudelMirror({
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      transpiler,
      autodraw: false,
      root: containerRef.current,
      initialCode: '// LOADING',
      pattern: silence,
      drawTime,
      onDraw,
      prebake: async () => Promise.all([modulesLoading, presets]),
      onUpdateState: (state) => {
        setReplState({ ...state });
      },
      afterEval: ({ code }) => {
        updateUserCode(code);
        // setPending(false);
        setLatestCode(code);
        window.location.hash = '#' + code2hash(code);
      },
      bgFill: false,
    });

    // init settings

    initCode().then((decoded) => {
      let msg;
      if (decoded) {
        editor.setCode(decoded);
        initUserCode(decoded);
        msg = `I have loaded the code from the URL.`;
      } else if (latestCode) {
        editor.setCode(latestCode);
        msg = `Your last session has been loaded!`;
      } else {
        editor.setCode(randomTune);
        msg = `A random code snippet named "${name}" has been loaded!`;
      }
      logger(`Welcome to Strudel! ${msg} Press play or hit ctrl+enter to run it!`, 'highlight');
      // setPending(false);
    });

    editorRef.current = editor;
  }, []);

  const [replState, setReplState] = useState({});
  const { started, isDirty, error, activeCode, pending } = replState;
  const editorRef = useRef();
  const containerRef = useRef();

  // this can be simplified once SettingsTab has been refactored to change codemirrorSettings directly!
  // this will be the case when the main repl is being replaced
  const _settings = useStore(settingsMap, { keys: Object.keys(defaultSettings) });
  useEffect(() => {
    let editorSettings = {};
    Object.keys(defaultSettings).forEach((key) => {
      if (_settings.hasOwnProperty(key)) {
        editorSettings[key] = _settings[key];
      }
    });
    editorRef.current?.updateSettings(editorSettings);
  }, [_settings]);

  // on first load, set stored audio device if possible
  useEffect(() => {
    const { audioDeviceName } = _settings;
    if (audioDeviceName !== defaultAudioDeviceName) {
      getAudioDevices().then((devices) => {
        const deviceID = devices.get(audioDeviceName);
        if (deviceID == null) {
          return;
        }
        setAudioDevice(deviceID);
      });
    }
  }, []);

  //
  // UI Actions
  //

  const handleTogglePlay = async () => editorRef.current?.toggle();
  const handleUpdate = async (newCode, reset = false) => {
    if (reset) {
      clearCanvas();
      resetLoadedSounds();
      editorRef.current.repl.setCps(1);
      await prebake(); // declare default samples
    }
    if (newCode) {
      editorRef.current.setCode(newCode);
      editorRef.current.repl.evaluate(newCode);
    } else if (isDirty) {
      editorRef.current.evaluate();
    }
  };
  const handleShuffle = async () => {
    // window.postMessage('strudel-shuffle');
    const { code, name } = getRandomTune();
    logger(`[repl] ✨ loading random tune "${name}"`);
    setActivePattern(name);
    clearCanvas();
    resetLoadedSounds();
    editorRef.current.repl.setCps(1);
    await prebake(); // declare default samples
    editorRef.current.setCode(code);
    editorRef.current.repl.evaluate(code);
  };

  const handleShare = async () => shareCode(activeCode);
  const context = {
    embedded,
    started,
    pending,
    isDirty,
    activeCode,
    handleTogglePlay,
    handleUpdate,
    handleShuffle,
    handleShare,
  };

  return (
    <ReplContext.Provider value={context}>
      <div className={cx('h-full flex flex-col relative')}>
        <Loader active={pending} />
        <Header context={context} />
        {isEmbedded && !started && (
          <button
            onClick={() => handleTogglePlay()}
            className="text-white text-2xl fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] z-[1000] m-auto p-4 bg-black rounded-md flex items-center space-x-2"
          >
            <PlayCircleIcon className="w-6 h-6" />
            <span>play</span>
          </button>
        )}
        <div className="grow flex relative overflow-hidden">
          <section
            className={'text-gray-100 cursor-text pb-0 overflow-auto grow' + (isZen ? ' px-10' : '')}
            id="code"
            ref={(el) => {
              containerRef.current = el;
              if (!editorRef.current) {
                init();
              }
            }}
          ></section>
          {panelPosition === 'right' && !isEmbedded && <Panel context={context} />}
        </div>
        {error && (
          <div className="text-red-500 p-4 bg-lineHighlight animate-pulse">{error.message || 'Unknown Error :-/'}</div>
        )}
        {panelPosition === 'bottom' && !isEmbedded && <Panel context={context} />}
      </div>
    </ReplContext.Provider>
  );
}
