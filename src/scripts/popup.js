class AurisPopup {
  constructor() {
    try {
      import('../scripts/common/featureFlags.js')
        .then((mod) => {
          try {
            const mode = mod.getEngineMode();
            console.log(`[Auris Popup] Engine Mode: ${mode}`);
          } catch (e) {
            console.warn('[Auris Popup] Failed to read engine mode:', e);
          }
        })
        .catch((err) => {
          console.debug(
            '[Auris Popup] Feature flags module not available (expected in Phase 0):',
            err?.message
          );
        });
    } catch (e) {
      console.debug('[Auris Popup] Inline engine mode check failed:', e);
    }
    try {
      this.volumeUpdateTimeout = null;
      this.bassUpdateTimeout = null;
      this.voiceUpdateTimeout = null;
      this._captureStatusInterval = null;
      this._initialCaptureApplied = false;


      this.initializeElements();
      this.bindEvents();
      this.loadTheme();
      this.loadSettings();

      import('../scripts/common/featureFlags.js').then((mod) => {
        const capture = mod.isCaptureEnabled && mod.isCaptureEnabled();
        if (capture) {
          this.initializeCaptureModeUI();
        } else {
          setTimeout(() => {
            this.testContentScriptConnection();
            this.checkAudioStatus();
          }, 100);
        }
      });

      console.log('Auris Popup: Initialization completed successfully');
    } catch (error) {
      console.error('Auris Popup: Critical initialization error:', error);
      this.handleCriticalError('Popup failed to initialize');
    }

    this.presets = {
      flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      rock: [4, 2, -2, -1, 0, 1, 3, 4, 4, 4],
      pop: [-1, 2, 4, 4, 1, -1, -1, 1, 2, 3],
      jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
      classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
      electronic: [3, 2, 0, -1, -2, 1, 0, 1, 3, 4],
      'hip-hop': [5, 4, 1, 3, -1, -1, 1, -1, 2, 3],
      vocal: [-2, -1, -1, 1, 3, 3, 2, 1, 0, -1],
      'bass-heavy': [6, 5, 4, 2, 1, -1, -2, -2, -1, 0],
      'treble-boost': [-2, -1, 0, 1, 2, 3, 4, 5, 6, 6],
    };

    this.defaults = {
      equalizer: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      audio: {
        volume: 100,
        bass: 0,
        voice: 0,
      },
      effects: {
        audio8dSpeed: 3,
        surroundDepth: 50,
        echoDelay: 250,
        echoFeedback: 30,
        audio8dActive: false,
        surroundActive: false,
        echoActive: false,
      },
    };

    import('../scripts/common/featureFlags.js')
      .then((mod) => {
        if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
          const volPercent = this.defaults.audio.volume;
          const gain = Math.max(0, volPercent / 100);
          this._sendCaptureApplySettings({ gain });
        }
      })
      .catch(() => {
        /* ignore */
      });
  }

  _sendCaptureApplySettings(payload) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab) {
          return;
        }
        chrome.runtime.sendMessage(
          {
            event: 'applySettings',
            tabId: tab.id,
            settings: payload,
          },
          (resp) => {
            if (resp && resp.ok) {
              console.log('[Auris Popup][Capture] applySettings ack', resp);
            } else if (resp && resp.error) {
              console.warn('[Auris Popup][Capture] applySettings error', resp.error);
            }
          }
        );
      });
    } catch (e) {
      console.warn('[Auris Popup] Failed to send capture applySettings:', e);
    }
  }

  initializeElements() {
    try {
      this.eqSliders = [
        document.getElementById('eq-32'),
        document.getElementById('eq-64'),
        document.getElementById('eq-125'),
        document.getElementById('eq-250'),
        document.getElementById('eq-500'),
        document.getElementById('eq-1k'),
        document.getElementById('eq-2k'),
        document.getElementById('eq-4k'),
        document.getElementById('eq-8k'),
        document.getElementById('eq-16k'),
      ];

      this.volumeSlider = document.getElementById('volume-boost');
      this.bassSlider = document.getElementById('bass-boost');
      this.voiceSlider = document.getElementById('voice-boost');

      this.audio8dSpeedSlider = document.getElementById('8d-speed');
      this.surroundDepthSlider = document.getElementById('surround-depth');
      this.echoDelaySlider = document.getElementById('echo-delay');
      this.echoFeedbackSlider = document.getElementById('echo-feedback');

      this.volumeValue = document.getElementById('volume-value');
      this.bassValue = document.getElementById('bass-value');
      this.voiceValue = document.getElementById('voice-value');
      this.audio8dSpeedValue = document.getElementById('8d-speed-value');
      this.surroundDepthValue = document.getElementById('surround-depth-value');
      this.echoDelayValue = document.getElementById('echo-delay-value');
      this.echoFeedbackValue = document.getElementById('echo-feedback-value');

      this.audio8dToggle = document.getElementById('8d-toggle');
      this.surroundToggle = document.getElementById('surround-toggle');
      this.echoToggle = document.getElementById('echo-toggle');

      this.presetSelect = document.getElementById('preset-select');
      this.statusElement = document.getElementById('status');
      this.settingsToggle = document.getElementById('settings-toggle');
      this.sidebar = document.getElementById('sidebar');
      this.sidebarOverlay = document.getElementById('sidebar-overlay');
      this.sidebarClose = document.getElementById('sidebar-close');
      this.themeToggle = document.getElementById('theme-toggle');
      this.currentThemeText = document.getElementById('current-theme-text');
      this.leaveReviewBtn = document.getElementById('leave-review');
      this.reportIssueBtn = document.getElementById('report-issue');

      const criticalElements = [
        { element: this.volumeSlider, name: 'volume-boost' },
        { element: this.bassSlider, name: 'bass-boost' },
        { element: this.voiceSlider, name: 'voice-boost' },
        { element: this.statusElement, name: 'status' },
      ];

      const missingElements = criticalElements.filter((item) => !item.element);
      if (missingElements.length > 0) {
        const missingNames = missingElements.map((item) => item.name).join(', ');
        throw new Error(`Critical elements missing: ${missingNames}`);
      }

      const missingEqSliders = this.eqSliders.filter((slider) => !slider).length;
      if (missingEqSliders > 0) {
        console.warn(`Auris: ${missingEqSliders} EQ slider elements missing`);
      }

      console.log('Auris: All elements initialized successfully');
      this.activeTabsBtn = document.getElementById('active-tabs-btn');
      this.tabsSidebar = document.getElementById('tabs-sidebar');
      this.tabsSidebarOverlay = document.getElementById('tabs-sidebar-overlay');
      this.tabsSidebarClose = document.getElementById('tabs-sidebar-close');
      this.activeTabsList = document.getElementById('active-tabs-list');
    } catch (error) {
      console.error('Auris: Failed to initialize popup elements:', error);
      this.showErrorState('Interface elements failed to load');
    }
  }

  initializeCaptureModeUI() {
    this.setStatusInactive('Initializing...');
    this.startCaptureStatusPolling();
    this.renderActiveTabs();
    this.subscribeActiveTabsChanges();
    // Request an immediate status
    this.pollCaptureStatus();
  }

  startCaptureStatusPolling() {
    if (this._captureStatusInterval) {
      return;
    }
    this._captureStatusInterval = setInterval(() => this.pollCaptureStatus(), 1000);
  }

  pollCaptureStatus() {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab) {
          return;
        }
        const audioActive = !!tab.audible;
        this.updateBinaryStatus(audioActive);
      });
    } catch (e) {
      console.warn('[Auris Popup] pollCaptureStatus audible check failed:', e);
    }
  }

  updateBinaryStatus(audioActive) {
    if (!this.statusElement) {
      return;
    }
    const newLabel = audioActive ? 'Audio Detected' : 'No Audio Detected';
    this.statusElement.textContent = newLabel;
    this.statusElement.classList.toggle('inactive', !audioActive);
    this.statusElement.classList.toggle('active', audioActive);
  }

  subscribeActiveTabsChanges() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.aurisAudibleTabs) {
        const val = changes.aurisAudibleTabs.newValue;
        this.renderActiveTabs(val && val.tabs ? val.tabs : []);
      }
    });
  }

  async renderActiveTabs(audibleArray) {
    if (!this.activeTabsList) return;
    let list = audibleArray;
    if (!Array.isArray(list)) {
      const data = await chrome.storage.session.get('aurisAudibleTabs');
      list = (data.aurisAudibleTabs && data.aurisAudibleTabs.tabs) || [];
    }
    this.activeTabsList.innerHTML = '';
    if (list.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No active audio';
      this.activeTabsList.appendChild(li);
      return;
    }
    list.forEach((info) => {
      const tabId = info.id;
      const title = info.title || `Tab ${tabId}`;
      const icon = info.icon || '../icons/auris-icon-light-svg-16.png';
      const safeTitle = title.toString();
      const li = document.createElement('li');
      li.className = 'active-tab-item clickable-tab';
      li.setAttribute('data-tab-id', tabId);
      li.title = 'Click to switch to this tab';
      li.innerHTML = `
          <img class="tab-favicon" src="${icon}" alt="" onerror="this.src='../icons/auris-icon-light-svg-16.png'" />
          <span class="tab-title" title="${safeTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">${safeTitle}</span>
          <button class="tab-close-btn" title="Close tab" data-tab-id="${tabId}">×</button>
        `;

      li.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tab-close-btn')) {
          this.switchToTab(parseInt(tabId));
        }
      });
      const closeBtn = li.querySelector('.tab-close-btn');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(parseInt(tabId));
      });
      this.activeTabsList.appendChild(li);
    });
  }

  switchToTab(tabId) {
    try {
      chrome.tabs.update(tabId, { active: true }, (tab) => {
        if (chrome.runtime.lastError) {
          console.error('Error switching to tab:', chrome.runtime.lastError.message);
          return;
        }
        
        if (tab && tab.windowId) {
          chrome.windows.update(tab.windowId, { focused: true }, (window) => {
            if (chrome.runtime.lastError) {
              console.warn('Could not focus window:', chrome.runtime.lastError.message);
            }
          });
        }
        
        this.closeTabsSidebar();
      });
    } catch (error) {
      console.error('Error switching to tab:', error);
    }
  }

  closeTab(tabId) {
    try {
      chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
          console.error('Error closing tab:', chrome.runtime.lastError.message);
          return;
        }
        
        this.renderActiveTabs();
      });
    } catch (error) {
      console.error('Error closing tab:', error);
    }
  }

  bindEvents() {
    try {
      this.eqSliders.forEach((slider, index) => {
        if (slider) {
          slider.addEventListener('input', () => {
            try {
              this.updateSliderProgress(slider);
              this.updateEqualizer();
              this.saveSettings();
              this.checkEqualizerReset();
            } catch (error) {
              console.error(`🎛️ Auris: Error handling EQ slider ${index}:`, error);
            }
          });
        } else {
          console.warn(`Auris: EQ slider ${index} not found, skipping event binding`);
        }
      });

      this.volumeSlider.addEventListener('input', () => {
        this.volumeValue.textContent = this.volumeSlider.value + '%';
        this.updateSliderProgress(this.volumeSlider);
        this.updateAudioSettings();
        clearTimeout(this.volumeUpdateTimeout);
        this.volumeUpdateTimeout = setTimeout(() => {
          this.saveSettings();
        }, 200);
      });

      this.bassSlider.addEventListener('input', () => {
        this.bassValue.textContent = this.bassSlider.value + 'dB';
        this.updateSliderProgress(this.bassSlider);
        this.updateAudioSettings();
        clearTimeout(this.bassUpdateTimeout);
        this.bassUpdateTimeout = setTimeout(() => {
          this.saveSettings();
        }, 200);
      });

      this.voiceSlider.addEventListener('input', () => {
        this.voiceValue.textContent = this.voiceSlider.value + 'dB';
        this.updateSliderProgress(this.voiceSlider);
        this.updateAudioSettings();
        clearTimeout(this.voiceUpdateTimeout);
        this.voiceUpdateTimeout = setTimeout(() => {
          this.saveSettings();
        }, 200);
      });

      this.audio8dSpeedSlider.addEventListener('input', () => {
        this.audio8dSpeedValue.textContent = this.audio8dSpeedSlider.value + 's';
        this.updateSliderProgress(this.audio8dSpeedSlider);
        this.updateEffectSettings();
        this.saveSettings();
      });

      this.surroundDepthSlider.addEventListener('input', () => {
        this.surroundDepthValue.textContent = this.surroundDepthSlider.value + '%';
        this.updateSliderProgress(this.surroundDepthSlider);
        this.updateEffectSettings();
        this.saveSettings();
      });

      this.echoDelaySlider.addEventListener('input', () => {
        this.echoDelayValue.textContent = this.echoDelaySlider.value + 'ms';
        this.updateSliderProgress(this.echoDelaySlider);
        this.updateEffectSettings();
        this.saveSettings();
      });

      this.echoFeedbackSlider.addEventListener('input', () => {
        this.echoFeedbackValue.textContent = this.echoFeedbackSlider.value + '%';
        this.updateSliderProgress(this.echoFeedbackSlider);
        this.updateEffectSettings();
        this.saveSettings();
      });

      this.audio8dToggle.addEventListener('click', () => {
        this.toggle8dAudio();
      });

      this.surroundToggle.addEventListener('click', () => {
        this.toggleSurroundSound();
      });

      this.echoToggle.addEventListener('click', () => {
        this.toggleEcho();
      });

      this.presetSelect.addEventListener('change', () => {
        this.applyPreset(this.presetSelect.value);
      });

      this.initializeCustomDropdown();
      document.getElementById('reset-eq').addEventListener('click', () => {
        this.resetEqualizer();
      });

      document.getElementById('reset-audio').addEventListener('click', () => {
        this.resetAudioControls();
      });

      document.getElementById('reset-effects').addEventListener('click', () => {
        this.resetEffects();
      });

      this.setupResetButtonEffects();
      document.getElementById('nav-equalizer').addEventListener('click', () => {
        this.showSection('equalizer');
      });

      document.getElementById('nav-audio').addEventListener('click', () => {
        this.showSection('audio');
      });

      document.getElementById('nav-effects').addEventListener('click', () => {
        this.showSection('effects');
      });

      if (this.settingsToggle) {
        this.settingsToggle.addEventListener('click', () => {
          try {
            this.openSidebar();
          } catch (error) {
            console.error('🎛️ Auris: Error opening sidebar:', error);
          }
        });
      }

      if (this.sidebarClose) {
        this.sidebarClose.addEventListener('click', () => {
          this.closeSidebar();
        });
      }
      if (this.sidebarOverlay) {
        this.sidebarOverlay.addEventListener('click', () => {
          this.closeSidebar();
        });
      }

      if (this.themeToggle) {
        this.themeToggle.addEventListener('click', () => {
          try {
            this.toggleTheme();
          } catch (error) {
            console.error('🎛️ Auris: Error toggling theme:', error);
          }
        });
      }
      if (this.leaveReviewBtn) {
        this.leaveReviewBtn.addEventListener('click', () => {
          this.openReviewLink();
        });
      }

      if (this.reportIssueBtn) {
        this.reportIssueBtn.addEventListener('click', () => {
          this.openIssueLink();
        });
      }

      if (this.activeTabsBtn) {
        this.activeTabsBtn.addEventListener('click', () => {
          this.openTabsSidebar();
        });
      }

      if (this.tabsSidebarClose) {
        this.tabsSidebarClose.addEventListener('click', () => {
          this.closeTabsSidebar();
        });
      }

      if (this.tabsSidebarOverlay) {
        this.tabsSidebarOverlay.addEventListener('click', () => {
          this.closeTabsSidebar();
        });
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.sidebar?.classList.contains('active')) {
            this.closeSidebar();
          }
          if (this.tabsSidebar?.classList.contains('active')) {
            this.closeTabsSidebar();
          }
        }
      });

      this.initializeSliderProgress();

      console.log('Auris: All events bound successfully');
    } catch (error) {
      console.error('Auris: Failed to bind events:', error);
      this.showErrorState('Failed to setup interface controls');
    }
  }

  updateSliderProgress(slider) {
    const value = parseFloat(slider.value);
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const percentage = ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--slider-progress', `${percentage}%`);

    if (slider.parentElement && slider.parentElement.classList.contains('equalizer')) {
      const isActive = Math.abs(value) > 0.1;
      slider.setAttribute('data-active', isActive.toString());
    }
  }

  initializeSliderProgress() {
    this.eqSliders.forEach((slider) => {
      if (slider) {
        this.updateSliderProgress(slider);
      }
    });

    this.updateSliderProgress(this.volumeSlider);
    this.updateSliderProgress(this.bassSlider);
    this.updateSliderProgress(this.voiceSlider);
    this.updateSliderProgress(this.audio8dSpeedSlider);
    this.updateSliderProgress(this.surroundDepthSlider);
    this.updateSliderProgress(this.echoDelaySlider);
    this.updateSliderProgress(this.echoFeedbackSlider);
  }

  checkEqualizerReset() {
    const currentValues = this.eqSliders.map((slider) => parseFloat(slider.value));
    const hasChanged = currentValues.some(
      (value, index) => value !== this.defaults.equalizer[index]
    );
    const resetBtn = document.getElementById('reset-eq');
    resetBtn.classList.toggle('active', hasChanged);
  }

  checkAudioReset() {
    const hasChanged =
      parseFloat(this.volumeSlider.value) !== this.defaults.audio.volume ||
      parseFloat(this.bassSlider.value) !== this.defaults.audio.bass ||
      parseFloat(this.voiceSlider.value) !== this.defaults.audio.voice;

    const resetBtn = document.getElementById('reset-audio');
    resetBtn.classList.toggle('active', hasChanged);
  }

  checkEffectsReset() {
    const hasChanged =
      parseFloat(this.audio8dSpeedSlider.value) !== this.defaults.effects.audio8dSpeed ||
      parseFloat(this.surroundDepthSlider.value) !== this.defaults.effects.surroundDepth ||
      parseFloat(this.echoDelaySlider.value) !== this.defaults.effects.echoDelay ||
      parseFloat(this.echoFeedbackSlider.value) !== this.defaults.effects.echoFeedback ||
      this.audio8dToggle.classList.contains('active') !== this.defaults.effects.audio8dActive ||
      this.surroundToggle.classList.contains('active') !== this.defaults.effects.surroundActive ||
      this.echoToggle.classList.contains('active') !== this.defaults.effects.echoActive;

    const resetBtn = document.getElementById('reset-effects');
    resetBtn.classList.toggle('active', hasChanged);
  }

  openSidebar() {
    if (this.toggleCustomDropdown) {
      this.toggleCustomDropdown(false);
    }
    
    if (this.sidebar && this.sidebarOverlay) {
      this.sidebar.classList.add('active');
      this.sidebarOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      
      if (this.settingsToggle) {
        this.settingsToggle.classList.add('active');
      }
    }
  }

  closeSidebar() {
    if (this.sidebar && this.sidebarOverlay) {
      this.sidebar.classList.remove('active');
      this.sidebarOverlay.classList.remove('active');
      document.body.style.overflow = '';
      
      if (this.settingsToggle) {
        this.settingsToggle.classList.remove('active');
      }
    }
  }

  openTabsSidebar() {
    if (this.toggleCustomDropdown) {
      this.toggleCustomDropdown(false);
    }
    
    if (this.tabsSidebar && this.tabsSidebarOverlay) {
      this.tabsSidebar.classList.add('active');
      this.tabsSidebarOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }

  closeTabsSidebar() {
    if (this.tabsSidebar && this.tabsSidebarOverlay) {
      this.tabsSidebar.classList.remove('active');
      this.tabsSidebarOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  toggleTheme() {
    const body = document.body;
    const isLight = body.classList.contains('light-theme');

    if (isLight) {
      body.classList.remove('light-theme');
      localStorage.setItem('auris-theme', 'dark');
    } else {
      body.classList.add('light-theme');
      localStorage.setItem('auris-theme', 'light');
    }
    
    this.updateCurrentThemeText();
  }

  loadTheme() {
    const savedTheme = localStorage.getItem('auris-theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-theme');
    }
    this.updateCurrentThemeText();
  }

  updateCurrentThemeText() {
    if (this.currentThemeText) {
      const isLight = document.body.classList.contains('light-theme');
      this.currentThemeText.textContent = isLight ? 'Light' : 'Dark';
    }
  }

  openReviewLink() {
    const reviewUrl = 'https://chromewebstore.google.com/detail/auris-audio-equalizer/placeholder-id/reviews';
    chrome.tabs.create({ url: reviewUrl });
  }

  openIssueLink() {
    const issueUrl = 'https://github.com/nnilayy/Auris/issues/new';
    chrome.tabs.create({ url: issueUrl });
  }

  updateEqualizer() {
    const eqValues = this.eqSliders.map((slider) => parseFloat(slider.value));
    this.sendMessageToContent({ type: 'updateEqualizer', values: eqValues });

    import('../scripts/common/featureFlags.js')
      .then((mod) => {
        if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
          if (!this._initialCaptureApplied) { return; }
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) {
              return;
            }
            chrome.runtime.sendMessage(
              {
                event: 'updateEQ',
                tabId: tab.id,
                settings: undefined,
                eq: eqValues,
              },
              (resp) => {
                if (resp && resp.ok) {
                } else if (resp && resp.error) {
                  console.warn('[Auris Popup][Capture] updateEQ error', resp.error);
                }
              }
            );
          });
        }
      })
      .catch(() => {});
    this.checkEqualizerReset();
  }

  updateAudioSettings() {
    const settings = {
      volumeBoost: parseFloat(this.volumeSlider.value),
      bassBoost: parseFloat(this.bassSlider.value),
      voiceBoost: parseFloat(this.voiceSlider.value),
    };

    this.sendMessageToContent({
      type: 'updateAudioSettings',
      settings: settings,
    });
    // Capture path (Phase 4): updateControls
    import('../scripts/common/featureFlags.js')
      .then((mod) => {
        if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
          if (!this._initialCaptureApplied) { return; }
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) {
              return;
            }
            chrome.runtime.sendMessage(
              {
                event: 'updateControls',
                tabId: tab.id,
                controls: settings,
              },
              (resp) => {
                if (resp && !resp.ok) {
                  console.warn('[Auris Popup][Capture] updateControls error', resp.error);
                }
              }
            );
          });
        }
      })
      .catch(() => {});
    this.checkAudioReset();
  }

  updateEffectSettings() {
    const effectSettings = {
      audio8dSpeed: parseFloat(this.audio8dSpeedSlider.value),
      surroundDepth: parseFloat(this.surroundDepthSlider.value),
      echoDelay: parseFloat(this.echoDelaySlider.value),
      echoFeedback: parseFloat(this.echoFeedbackSlider.value),
    };

    this.sendMessageToContent({
      type: 'updateEffectSettings',
      settings: effectSettings,
    });
    // Capture path (Phase 5): updateEffectParams for 8D speed + surround depth
    import('../scripts/common/featureFlags.js')
      .then((mod) => {
        if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
          if (!this._initialCaptureApplied) { return; }
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) {
              return;
            }
            chrome.runtime.sendMessage({
              event: 'updateEffectParams',
              tabId: tab.id,
              name: 'audio8d',
              params: { speed: effectSettings.audio8dSpeed },
            });
            chrome.runtime.sendMessage({
              event: 'updateEffectParams',
              tabId: tab.id,
              name: 'surround',
              params: { depth: effectSettings.surroundDepth },
            });
          });
        }
      })
      .catch(() => {});
    this.checkEffectsReset();
  }

  toggle8dAudio() {
    const isActive = this.audio8dToggle.classList.toggle('active');
    this.sendMessageToContent({
      type: 'toggle8dAudio',
      enabled: isActive,
    });
    import('../scripts/common/featureFlags.js')
      .then((mod) => {
        if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) {
              return;
            }
            chrome.runtime.sendMessage({
              event: 'toggleEffect',
              tabId: tab.id,
              name: 'audio8d',
              active: isActive,
            });
          });
        }
      })
      .catch(() => {});
    this.saveSettings();
    this.checkEffectsReset();
  }

  toggleSurroundSound() {
    const isActive = this.surroundToggle.classList.toggle('active');
    this.sendMessageToContent({
      type: 'toggleSurroundSound',
      enabled: isActive,
    });
    import('../scripts/common/featureFlags.js')
      .then((mod) => {
        if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) {
              return;
            }
            chrome.runtime.sendMessage({
              event: 'toggleEffect',
              tabId: tab.id,
              name: 'surround',
              active: isActive,
            });
          });
        }
      })
      .catch(() => {});
    this.saveSettings();
    this.checkEffectsReset();
  }

  toggleEcho() {
    const isActive = this.echoToggle.classList.toggle('active');
    this.sendMessageToContent({
      type: 'toggleEcho',
      enabled: isActive,
    });
    import('../scripts/common/featureFlags.js')
      .then((mod) => {
        if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) {
              return;
            }
            chrome.runtime.sendMessage({
              event: 'toggleEffect',
              tabId: tab.id,
              name: 'echo',
              active: isActive,
            });
          });
        }
      })
      .catch(() => {});
    this.saveSettings();
    this.checkEffectsReset();
  }

  applyPreset(presetName) {
    if (this.presets[presetName]) {
      const values = this.presets[presetName];
      this.eqSliders.forEach((slider, index) => {
        slider.value = values[index];
        // Update slider progress to make sure the trail follows the new value
        this.updateSliderProgress(slider);
      });
      this.updateEqualizer();
      this.saveSettings();
    }
  }

  async sendMessageToContent(message) {
    // Content scripts removed; bypass when capture enabled
    try {
      const mod = await import('../scripts/common/featureFlags.js');
      if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
        return false; // No-op in capture-only mode
      }
    } catch (_) {
      /* ignore */
    }
    let attempts = 0;
    const maxAttempts = 3;

    const attemptSend = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          console.warn('🎛️ Auris: No active tab found for message sending');
          return false;
        }

        const response = await chrome.tabs.sendMessage(tab.id, message);
        console.log('Auris: Message sent successfully:', message.type);
        return true;
      } catch (error) {
        attempts++;

        if (attempts >= maxAttempts) {
          // Log the error with proper details for debugging
          console.error('Auris: Failed to send message to content script:', error);
          console.error('Auris: Message type:', message.type || 'unknown');
          console.error('Auris: Error details:', error.message);

          // Update status to show communication issue
          this.setStatusInactive('Communication error');
          return false;
        }

        // Short retry delay
        await new Promise((resolve) => setTimeout(resolve, 100));
        return attemptSend();
      }
    };

    return attemptSend();
  }

  async testContentScriptConnection() {
    let attempts = 0;
    const maxAttempts = 5;
    const retryDelay = 500; // Start with 500ms delay

    const attemptConnection = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          console.warn('Auris: No active tab found for connection test');
          this.setStatusInactive('No active tab');
          return false;
        }

        // Check if this is a restricted page where content scripts can't run
        if (this.isRestrictedPage(tab.url)) {
          console.info('Auris: Content scripts cannot run on this page:', tab.url);
          this.setStatusInactive('Not available on this page');
          return false;
        }

        // Test with a ping message with a timeout
        const response = await Promise.race([
          chrome.tabs.sendMessage(tab.id, { type: 'ping' }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection timeout')), 1000)
          ),
        ]);

        if (response && response.status === 'pong') {
          console.log('🎛️ Auris: Content script connection verified');
          return true;
        } else {
          throw new Error('Invalid response format');
        }
      } catch (error) {
        attempts++;

        if (attempts >= maxAttempts) {
          // Handle specific Chrome extension errors
          if (
            error.message.includes('Could not establish connection') ||
            error.message.includes('Receiving end does not exist')
          ) {
            console.info(
              '🎛️ Auris: Content script not loaded on this page - this is normal for some pages'
            );
            this.setStatusInactive('Extension loading...');
          } else if (error.message.includes('Connection timeout')) {
            console.warn('🎛️ Auris: Content script connection timed out');
            this.setStatusInactive('Connection timeout');
          } else {
            console.error('🎛️ Auris: Content script connection test failed:', error);
            this.setStatusInactive('Connection error');
          }
          return false;
        }

        // Retry with exponential backoff
        console.log(`Auris: Connection attempt ${attempts} failed, retrying...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay * attempts));
        return attemptConnection();
      }
    };

    return attemptConnection();
  }

  isRestrictedPage(url) {
    if (!url) {
      return true;
    }

    const restrictedPrefixes = [
      'chrome://',
      'chrome-extension://',
      'moz-extension://',
      'about:',
      'edge://',
      'opera://',
      'brave://',
      'vivaldi://',
      'file://',
    ];

    return restrictedPrefixes.some((prefix) => url.startsWith(prefix));
  }

  async checkAudioStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'checkAudioStatus' });

      if (response && response.success) {
        const {
          contextsActive = 0,
          chainsActive = 0,
          audioDetected = false,
          mediaElementsActive = 0,
        } = response;

        if (audioDetected) {
          let statusText = 'Audio Active';
          if (mediaElementsActive > 0) {
            statusText += ` - ${mediaElementsActive} media playing`;
          }
          if (contextsActive > 0) {
            statusText += ` - ${contextsActive} contexts`;
          }
          this.statusElement.textContent = statusText;
          this.statusElement.className = 'status active';
        } else if (contextsActive > 0 || chainsActive > 0) {
          this.statusElement.textContent = `Ready - ${contextsActive} contexts, ${chainsActive} chains`;
          this.statusElement.className = 'status active';
        } else {
          this.setStatusInactive();
        }
      } else {
        this.setStatusInactive();
      }
    } catch (error) {
      this.setStatusInactive('No Audio Detected');
    }

    // Check again in 2 seconds
    setTimeout(() => this.checkAudioStatus(), 2000);
  }

  setStatusInactive(message = 'No Audio Detected') {
    if (this.statusElement) {
      this.statusElement.textContent = `${message}`;
      this.statusElement.className = 'status inactive';
    }
  }

  saveSettings() {
    try {
      const settings = {
        equalizer: this.eqSliders.map((slider) => parseFloat(slider.value)),
        volumeBoost: parseFloat(this.volumeSlider.value),
        bassBoost: parseFloat(this.bassSlider.value),
        voiceBoost: parseFloat(this.voiceSlider.value),
        audio8d: this.audio8dToggle.classList.contains('active'),
        surround: this.surroundToggle.classList.contains('active'),
        echo: this.echoToggle.classList.contains('active'),
        audio8dSpeed: parseFloat(this.audio8dSpeedSlider.value),
        surroundDepth: parseFloat(this.surroundDepthSlider.value),
        echoDelay: parseFloat(this.echoDelaySlider.value),
        echoFeedback: parseFloat(this.echoFeedbackSlider.value),
        preset: this.presetSelect.value,
      };

      chrome.storage.local.set({ aurisSettings: settings });
    } catch (error) {
      console.error('Auris: Failed to save settings:', error);
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get('aurisSettings');
      if (result.aurisSettings) {
        const settings = result.aurisSettings;

        // Load equalizer
        if (settings.equalizer) {
          this.eqSliders.forEach((slider, index) => {
            slider.value = settings.equalizer[index] || 0;
          });
        }

        // Load controls
        this.volumeSlider.value = settings.volumeBoost || 100;
        this.bassSlider.value = settings.bassBoost || 0;
        this.voiceSlider.value = settings.voiceBoost || 0;
        this.audio8dSpeedSlider.value = settings.audio8dSpeed || 3;
        this.surroundDepthSlider.value = settings.surroundDepth || 50;
        this.echoDelaySlider.value = settings.echoDelay || 250;
        this.echoFeedbackSlider.value = settings.echoFeedback || 30;

        // Update value displays
        this.volumeValue.textContent = this.volumeSlider.value + '%';
        this.bassValue.textContent = this.bassSlider.value + 'dB';
        this.voiceValue.textContent = this.voiceSlider.value + 'dB';
        this.audio8dSpeedValue.textContent = this.audio8dSpeedSlider.value + 's';
        this.surroundDepthValue.textContent = this.surroundDepthSlider.value + '%';
        this.echoDelayValue.textContent = this.echoDelaySlider.value + 'ms';
        this.echoFeedbackValue.textContent = this.echoFeedbackSlider.value + '%';

        // Update slider progress
        this.initializeSliderProgress();

        // Load toggles
        if (settings.audio8d) {
          this.audio8dToggle.classList.add('active');
        }
        if (settings.surround) {
          this.surroundToggle.classList.add('active');
        }
        if (settings.echo) {
          this.echoToggle.classList.add('active');
        }

        // Load preset
        if (settings.preset) {
          this.presetSelect.value = settings.preset;
        }

        // Consolidated initial apply for capture mode
        import('../scripts/common/featureFlags.js')
          .then((mod) => {
            if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs && tabs[0];
                if (!tab) { return; }
                const eqArray = this.eqSliders.map((s) => parseFloat(s.value));
                const volumeBoost = parseFloat(this.volumeSlider.value) || 100;
                const bassBoost = parseFloat(this.bassSlider.value) || 0;
                const voiceBoost = parseFloat(this.voiceSlider.value) || 0;
                const gain = Math.max(0, volumeBoost / 100);
                chrome.runtime.sendMessage({
                  event: 'applySettings',
                  tabId: tab.id,
                  settings: { gain, volumeBoost, bassBoost, voiceBoost, eq: eqArray },
                }, () => {
                  this._initialCaptureApplied = true;
                  if (this.audio8dToggle.classList.contains('active')) {
                    chrome.runtime.sendMessage({ event: 'toggleEffect', tabId: tab.id, name: 'audio8d', active: true });
                    chrome.runtime.sendMessage({ event: 'updateEffectParams', tabId: tab.id, name: 'audio8d', params: { speed: parseFloat(this.audio8dSpeedSlider.value) } });
                  }
                  if (this.surroundToggle.classList.contains('active')) {
                    chrome.runtime.sendMessage({ event: 'toggleEffect', tabId: tab.id, name: 'surround', active: true });
                    chrome.runtime.sendMessage({ event: 'updateEffectParams', tabId: tab.id, name: 'surround', params: { depth: parseFloat(this.surroundDepthSlider.value) } });
                  }
                  if (this.echoToggle.classList.contains('active')) {
                    chrome.runtime.sendMessage({ event: 'toggleEffect', tabId: tab.id, name: 'echo', active: true });
                    chrome.runtime.sendMessage({ event: 'updateEffectParams', tabId: tab.id, name: 'echo', params: { delay: parseFloat(this.echoDelaySlider.value) / 1000, feedback: parseFloat(this.echoFeedbackSlider.value) / 100, wet: 0.5 } });
                  }
                });
              });
            } else {
              this.updateEqualizer();
              this.updateAudioSettings();
              this.updateEffectSettings();
            }
          })
          .catch(() => {
            this.updateEqualizer();
            this.updateAudioSettings();
            this.updateEffectSettings();
          });

        import('../scripts/common/featureFlags.js')
          .then((mod) => {
            if (!(mod.isCaptureEnabled && mod.isCaptureEnabled())) {
              if (settings.audio8d) {
                this.sendMessageToContent({ type: 'toggle8dAudio', enabled: true });
              }
              if (settings.surround) {
                this.sendMessageToContent({ type: 'toggleSurroundSound', enabled: true });
              }
              if (settings.echo) {
                this.sendMessageToContent({ type: 'toggleEcho', enabled: true });
              }
            }
          })
          .catch(() => {});

        this.checkEqualizerReset();
        this.checkAudioReset();
        this.checkEffectsReset();
      }
    } catch (error) {
      console.error('Auris: Failed to load settings from storage:', error);

      this.checkEqualizerReset();
      this.checkAudioReset();
      this.checkEffectsReset();
      if (this.statusElement) {
        this.statusElement.textContent = 'Using default settings';
        this.statusElement.className = 'status warning';
      }
    }
  }

  resetEqualizer() {
    this.eqSliders.forEach((slider) => {
      slider.value = 0;
      this.updateSliderProgress(slider);
    });

    if (this.presetSelect) {
      this.presetSelect.value = 'flat';
      
      if (this.customSelectTrigger) {
        this.customSelectTrigger.textContent = 'Flat';
      }
      if (this.customSelectOptions) {
        this.customSelectOptions.querySelectorAll('.custom-select-option').forEach((opt) => {
          opt.classList.remove('selected');
          if (opt.dataset.value === 'flat') {
            opt.classList.add('selected');
          }
        });
      }
    }

    this.updateEqualizer();
    this.saveSettings();
  }

  resetAudioControls() {
    this.volumeSlider.value = 100;
    this.bassSlider.value = 0;
    this.voiceSlider.value = 0;

    this.volumeValue.textContent = '100%';
    this.bassValue.textContent = '0dB';
    this.voiceValue.textContent = '0dB';

    this.updateSliderProgress(this.volumeSlider);
    this.updateSliderProgress(this.bassSlider);
    this.updateSliderProgress(this.voiceSlider);

    this.updateAudioSettings();
    this.saveSettings();
  }

  resetEffects() {
    this.audio8dSpeedSlider.value = 3;
    this.surroundDepthSlider.value = 50;
    this.echoDelaySlider.value = 250;
    this.echoFeedbackSlider.value = 30;

    this.audio8dSpeedValue.textContent = '3s';
    this.surroundDepthValue.textContent = '50%';
    this.echoDelayValue.textContent = '250ms';
    this.echoFeedbackValue.textContent = '30%';

    this.updateSliderProgress(this.audio8dSpeedSlider);
    this.updateSliderProgress(this.surroundDepthSlider);
    this.updateSliderProgress(this.echoDelaySlider);
    this.updateSliderProgress(this.echoFeedbackSlider);

    this.audio8dToggle.classList.remove('active');
    this.surroundToggle.classList.remove('active');
    this.echoToggle.classList.remove('active');

    this.presetSelect.value = 'flat';

    this.updateEffectSettings();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) {
        return;
      }
      try {
        chrome.runtime.sendMessage({
          event: 'toggleEffect',
          tabId: tab.id,
          name: 'audio8d',
          active: false,
        });
        chrome.runtime.sendMessage({
          event: 'toggleEffect',
          tabId: tab.id,
          name: 'surround',
          active: false,
        });
        chrome.runtime.sendMessage({
          event: 'toggleEffect',
          tabId: tab.id,
          name: 'echo',
          active: false,
        });
      } catch (e) {
        console.warn('[Auris Popup] Failed to send reset effect toggles via runtime', e);
      }
    });

    this.saveSettings();
  }

  setupResetButtonEffects() {
    const resetButtons = ['reset-eq', 'reset-audio', 'reset-effects'];
    
    resetButtons.forEach(buttonId => {
      const button = document.getElementById(buttonId);
      if (button) {
        let isPressed = false;
        
        button.addEventListener('mousedown', (e) => {
          if (button.classList.contains('active')) {
            isPressed = true;
          }
        });
        
        button.addEventListener('mouseup', (e) => {
          isPressed = false;
        });
        
        button.addEventListener('mouseleave', (e) => {
          isPressed = false;
        });
      }
    });
  }

  showSection(sectionName) {
    document.querySelectorAll('.section-content').forEach((section) => {
      section.classList.add('hidden');
    });

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.remove('active');
    });

    document.getElementById(`section-${sectionName}`).classList.remove('hidden');
    document.getElementById(`nav-${sectionName}`).classList.add('active');
  }

  handleCriticalError(message) {
    try {
      document.body.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #ff4444;">
                    <h3>Auris Extension Error</h3>
                    <p>${message}</p>
                    <p style="font-size: 12px; color: #888;">
                        Please try refreshing the page or restarting the browser.
                    </p>
                </div>
            `;
    } catch (error) {
      console.error('Auris: Critical error handler failed:', error);
    }
  }

  showErrorState(message) {
    try {
      if (this.statusElement) {
        this.statusElement.textContent = `${message}`;
        this.statusElement.className = 'status error';
      }

      console.error('Auris Popup Error:', message);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'popup-error';
      errorDiv.innerHTML = `
                <div style="color: #ff4444; text-align: center; padding: 10px; font-size: 12px;">
                    ${message}
                </div>
            `;

      const popupBody = document.querySelector('.popup-container') || document.body;
      if (popupBody && !document.querySelector('.popup-error')) {
        popupBody.insertBefore(errorDiv, popupBody.firstChild);
      }
    } catch (error) {
      console.error('Auris: Critical error - could not display error state:', error);
    }
  }

  initializeCustomDropdown() {
    this.createCustomDropdown();
    this.setupCustomDropdownEvents();
  }

  createCustomDropdown() {
    const controlRow = this.presetSelect.parentElement;
    const selectLabel = controlRow.querySelector('.control-label');

    this.presetSelect.style.display = 'none';
    const customContainer = document.createElement('div');
    customContainer.className = 'custom-select-container';

    const trigger = document.createElement('button');
    trigger.className = 'custom-select-trigger';
    trigger.type = 'button';
    trigger.textContent = this.presetSelect.options[this.presetSelect.selectedIndex].text;

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-select-options';

    for (let i = 0; i < this.presetSelect.options.length; i++) {
      const option = document.createElement('div');
      option.className = 'custom-select-option';
      option.textContent = this.presetSelect.options[i].text;
      option.dataset.value = this.presetSelect.options[i].value;

      if (this.presetSelect.options[i].selected) {
        option.classList.add('selected');
      }

      optionsContainer.appendChild(option);
    }

    const blurOverlay = document.createElement('div');
    blurOverlay.className = 'dropdown-blur-overlay';

    customContainer.appendChild(trigger);
    customContainer.appendChild(optionsContainer);

    controlRow.insertBefore(customContainer, this.presetSelect);
    document.body.appendChild(blurOverlay);
    this.customSelectTrigger = trigger;
    this.customSelectOptions = optionsContainer;
    this.customSelectContainer = customContainer;
    this.dropdownBlurOverlay = blurOverlay;
  }

  setupCustomDropdownEvents() {
    let isOpen = false;

    this.customSelectTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCustomDropdown(!isOpen);
      isOpen = !isOpen;
    });

    this.customSelectOptions.addEventListener('click', (e) => {
      if (e.target.classList.contains('custom-select-option')) {
        const selectedValue = e.target.dataset.value;
        const selectedText = e.target.textContent;

        this.customSelectTrigger.textContent = selectedText;
        this.presetSelect.value = selectedValue;
        this.customSelectOptions.querySelectorAll('.custom-select-option').forEach((opt) => {
          opt.classList.remove('selected');
        });
        e.target.classList.add('selected');

        this.applyPreset(selectedValue);
        this.toggleCustomDropdown(false);
        isOpen = false;
      }
    });

    this.dropdownBlurOverlay.addEventListener('click', () => {
      this.toggleCustomDropdown(false);
      isOpen = false;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        this.toggleCustomDropdown(false);
        isOpen = false;
      }
    });
  }

  toggleCustomDropdown(open) {
    if (open) {
      this.customSelectOptions.classList.add('open');
      this.customSelectTrigger.classList.add('active');
      this.dropdownBlurOverlay.classList.add('active');
    } else {
      this.customSelectOptions.classList.remove('open');
      this.customSelectTrigger.classList.remove('active');
      this.dropdownBlurOverlay.classList.remove('active');
    }
  }

  cleanup() {
    clearTimeout(this.volumeUpdateTimeout);
    clearTimeout(this.bassUpdateTimeout);
    clearTimeout(this.voiceUpdateTimeout);

    console.log('Auris Popup: Cleanup completed');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const aurisPopup = new AurisPopup();

  window.addEventListener('beforeunload', () => {
    aurisPopup.cleanup();
  });

  window.addEventListener('blur', () => {
    aurisPopup.cleanup();
  });
});
