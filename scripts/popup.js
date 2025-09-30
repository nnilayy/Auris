// Popup script for Auris Audio Equalizer
class AurisPopup {
  constructor() {
    // Phase 0 (Migration Scaffold): feature flag logging – no functional change.
    // Engine mode: using 'capture' pipeline by default.
    // TODO: Replace multi-state status logic with binary pill:
    //   - "Audio Detected" / "No Audio Detected" driven by capture analyser.
    try {
      // Dynamically import feature flag module if present (defensive in case of partial deploy)
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
          // Non-fatal: feature flags not yet deployed
          console.debug(
            '[Auris Popup] Feature flags module not available (expected in Phase 0):',
            err?.message
          );
        });
    } catch (e) {
      console.debug('[Auris Popup] Inline engine mode check failed:', e);
    }
    try {
      // Initialize debounce timeouts first
      this.volumeUpdateTimeout = null;
      this.bassUpdateTimeout = null;
      this.voiceUpdateTimeout = null;
      this._captureStatusInterval = null;
      this._lastStatus = null;
      this._statusStableCount = 0;

      // Initialize popup components
      this.initializeElements();
      this.bindEvents();
      this.loadTheme();
      this.loadSettings();

      import('../scripts/common/featureFlags.js').then((mod) => {
        const capture = mod.isCaptureEnabled && mod.isCaptureEnabled();
        if (capture) {
          // Skip content-script handshake
          this.initializeCaptureModeUI();
        } else {
          // Behavior retained until full removal
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

    // Presets configuration
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

    // Default values for checking if reset is needed
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
        audio8dActive: false,
        surroundActive: false,
        echoActive: false,
      },
    };

    // Phase 2: If engineMode switched manually to capture, send initial applySettings (gain-only)
    import('../scripts/common/featureFlags.js')
      .then((mod) => {
        if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
          // Map volume percent to normalized gain (basic placeholder)
          const volPercent = this.defaults.audio.volume; // actual loaded settings may override later
          const gain = Math.max(0, volPercent / 100);
          this._sendCaptureApplySettings({ gain });
        }
      })
      .catch(() => {
        /* ignore */
      });
  }

  // Phase 2 helper: capture-mode apply settings dispatcher
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
      // Equalizer sliders
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

      // Control sliders
      this.volumeSlider = document.getElementById('volume-boost');
      this.bassSlider = document.getElementById('bass-boost');
      this.voiceSlider = document.getElementById('voice-boost');

      // Effect control sliders
      this.audio8dSpeedSlider = document.getElementById('8d-speed');
      this.surroundDepthSlider = document.getElementById('surround-depth');

      // Value displays
      this.volumeValue = document.getElementById('volume-value');
      this.bassValue = document.getElementById('bass-value');
      this.voiceValue = document.getElementById('voice-value');
      this.audio8dSpeedValue = document.getElementById('8d-speed-value');
      this.surroundDepthValue = document.getElementById('surround-depth-value');

      // Toggle buttons
      this.audio8dToggle = document.getElementById('8d-toggle');
      this.surroundToggle = document.getElementById('surround-toggle');
      this.echoToggle = document.getElementById('echo-toggle');

      // Preset selector
      this.presetSelect = document.getElementById('preset-select');

      // Status indicator
      this.statusElement = document.getElementById('status');

      // Sidebar elements
      this.settingsToggle = document.getElementById('settings-toggle');
      this.sidebar = document.getElementById('sidebar');
      this.sidebarOverlay = document.getElementById('sidebar-overlay');
      this.sidebarClose = document.getElementById('sidebar-close');
      this.themeToggle = document.getElementById('theme-toggle');
      this.currentThemeText = document.getElementById('current-theme-text');
      this.leaveReviewBtn = document.getElementById('leave-review');
      this.reportIssueBtn = document.getElementById('report-issue');

      // Check for critical missing elements
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

      // Check EQ sliders
      const missingEqSliders = this.eqSliders.filter((slider) => !slider).length;
      if (missingEqSliders > 0) {
        console.warn(`Auris: ${missingEqSliders} EQ slider elements missing`);
      }

      console.log('Auris: All elements initialized successfully');
      // Active tabs elements
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
    this._captureStatusInterval = setInterval(() => this.pollCaptureStatus(), 2000);
  }

  pollCaptureStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) {
        return;
      }
      chrome.runtime.sendMessage({ event: 'requestStatus', tabId: tab.id }, (resp) => {
        const audioActive = resp?.status?.result?.audioActive || resp?.status?.audioActive;
        this.updateBinaryStatus(audioActive);
      });
    });
  }

  updateBinaryStatus(audioActive) {
    if (!this.statusElement) {
      return;
    }
    const newLabel = audioActive ? 'Audio Detected' : 'No Audio Detected';
    if (this._lastStatus === newLabel) {
      this._statusStableCount++;
    } else {
      this._statusStableCount = 0;
    }
    this._lastStatus = newLabel;
    // Require 1 stable confirmation (2 consecutive identical readings) to flip text
    if (this._statusStableCount >= 1 || !this.statusElement.textContent) {
      this.statusElement.textContent = newLabel;
      this.statusElement.classList.toggle('inactive', !audioActive);
      this.statusElement.classList.toggle('active', audioActive);
    }
  }

  subscribeActiveTabsChanges() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.aurisGainByTab) {
        this.renderActiveTabs(changes.aurisGainByTab.newValue);
      }
    });
  }

  async renderActiveTabs(mapOverride) {
    if (!this.activeTabsList) {
      return;
    }
    let map = mapOverride;
    if (!map) {
      const data = await chrome.storage.session.get('aurisGainByTab');
      map = data.aurisGainByTab || {};
    }
    const entries = Object.entries(map);
    this.activeTabsList.innerHTML = '';
    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No tabs yet';
      this.activeTabsList.appendChild(li);
      return;
    }
    // Sort by tabId numeric for stability
    entries.sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));

    // Fetch tab title + favicon for each entry and render nicely
    const fetchTab = (id) =>
      new Promise((resolve) => {
        try {
          chrome.tabs.get(Number(id), (tab) => {
            if (chrome.runtime.lastError || !tab) {
              return resolve({ id, title: `Tab ${id}`, icon: null });
            }
            resolve({ id, title: tab.title || `Tab ${id}`, icon: tab.favIconUrl || null });
          });
        } catch (_) {
          resolve({ id, title: `Tab ${id}`, icon: null });
        }
      });

    const details = await Promise.all(entries.map(([tabId]) => fetchTab(tabId)));

    details.forEach((info, idx) => {
      const [tabId, gain] = entries[idx];
      const pct = Math.round((parseFloat(gain) || 0) * 100);
      const li = document.createElement('li');
      li.className = 'active-tab-item clickable-tab';
      li.setAttribute('data-tab-id', tabId);
      li.title = 'Click to switch to this tab';
      const icon = info.icon || '../icons/auris-icon-light-svg-16.png';
      const safeTitle = (info.title || `Tab ${tabId}`).toString();
      li.innerHTML = `
                <img class="tab-favicon" src="${icon}" alt="" onerror="this.src='../icons/auris-icon-light-svg-16.png'" />
                <span class="tab-title" title="${safeTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">${safeTitle}</span>
                <span class="tab-pct">${pct}%</span>
                <button class="tab-close-btn" title="Close tab" data-tab-id="${tabId}">×</button>
            `;
      
      // Add click event listener to switch to tab (but not on close button)
      li.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tab-close-btn')) {
          this.switchToTab(parseInt(tabId));
        }
      });
      
      // Add close button event listener
      const closeBtn = li.querySelector('.tab-close-btn');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent tab switching
        this.closeTab(parseInt(tabId));
      });
      
      this.activeTabsList.appendChild(li);
    });
  }

  switchToTab(tabId) {
    try {
      // Switch to the tab and bring its window to front
      chrome.tabs.update(tabId, { active: true }, (tab) => {
        if (chrome.runtime.lastError) {
          console.error('Error switching to tab:', chrome.runtime.lastError.message);
          return;
        }
        
        // Also focus the window containing the tab
        if (tab && tab.windowId) {
          chrome.windows.update(tab.windowId, { focused: true }, (window) => {
            if (chrome.runtime.lastError) {
              console.warn('Could not focus window:', chrome.runtime.lastError.message);
            }
          });
        }
        
        // Close the sidebar after switching
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
        
        // Refresh the active tabs list after closing
        this.renderActiveTabs();
      });
    } catch (error) {
      console.error('Error closing tab:', error);
    }
  }

  bindEvents() {
    try {
      // Equalizer events - direct updates for immediate audio feedback
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

      // Control slider events - INSTANT UPDATES like EQ sliders
      this.volumeSlider.addEventListener('input', () => {
        this.volumeValue.textContent = this.volumeSlider.value + '%';
        this.updateSliderProgress(this.volumeSlider);
        // INSTANT audio update
        this.updateAudioSettings();
        // Debounced save to prevent excessive storage writes
        clearTimeout(this.volumeUpdateTimeout);
        this.volumeUpdateTimeout = setTimeout(() => {
          this.saveSettings();
        }, 200);
      });

      this.bassSlider.addEventListener('input', () => {
        this.bassValue.textContent = this.bassSlider.value + 'dB';
        this.updateSliderProgress(this.bassSlider);
        // INSTANT audio update
        this.updateAudioSettings();
        // Debounced save to prevent excessive storage writes
        clearTimeout(this.bassUpdateTimeout);
        this.bassUpdateTimeout = setTimeout(() => {
          this.saveSettings();
        }, 200);
      });

      this.voiceSlider.addEventListener('input', () => {
        this.voiceValue.textContent = this.voiceSlider.value + 'dB';
        this.updateSliderProgress(this.voiceSlider);
        // INSTANT audio update
        this.updateAudioSettings();
        // Debounced save to prevent excessive storage writes
        clearTimeout(this.voiceUpdateTimeout);
        this.voiceUpdateTimeout = setTimeout(() => {
          this.saveSettings();
        }, 200);
      });

      // Effect control sliders
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

      // Toggle button events
      this.audio8dToggle.addEventListener('click', () => {
        this.toggle8dAudio();
      });

      this.surroundToggle.addEventListener('click', () => {
        this.toggleSurroundSound();
      });

      this.echoToggle.addEventListener('click', () => {
        this.toggleEcho();
      });

      // Preset selection
      this.presetSelect.addEventListener('change', () => {
        this.applyPreset(this.presetSelect.value);
      });

      // Initialize custom dropdown functionality
      this.initializeCustomDropdown();

      // Reset button events
      document.getElementById('reset-eq').addEventListener('click', () => {
        this.resetEqualizer();
      });

      document.getElementById('reset-audio').addEventListener('click', () => {
        this.resetAudioControls();
      });

      document.getElementById('reset-effects').addEventListener('click', () => {
        this.resetEffects();
      });

      // Section navigation
      document.getElementById('nav-equalizer').addEventListener('click', () => {
        this.showSection('equalizer');
      });

      document.getElementById('nav-audio').addEventListener('click', () => {
        this.showSection('audio');
      });

      document.getElementById('nav-effects').addEventListener('click', () => {
        this.showSection('effects');
      });

      // Sidebar toggle
      if (this.settingsToggle) {
        this.settingsToggle.addEventListener('click', () => {
          try {
            this.openSidebar();
          } catch (error) {
            console.error('🎛️ Auris: Error opening sidebar:', error);
          }
        });
      }

      // Sidebar close
      if (this.sidebarClose) {
        this.sidebarClose.addEventListener('click', () => {
          this.closeSidebar();
        });
      }

      // Sidebar overlay
      if (this.sidebarOverlay) {
        this.sidebarOverlay.addEventListener('click', () => {
          this.closeSidebar();
        });
      }

      // Theme toggle
      if (this.themeToggle) {
        this.themeToggle.addEventListener('click', () => {
          try {
            this.toggleTheme();
          } catch (error) {
            console.error('🎛️ Auris: Error toggling theme:', error);
          }
        });
      }

      // Feedback buttons
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

      // Active tabs sidebar events
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

      // Keyboard support for sidebars
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

      // Initialize slider progress
      this.initializeSliderProgress();

      console.log('Auris: All events bound successfully');
    } catch (error) {
      console.error('Auris: Failed to bind events:', error);
      this.showErrorState('Failed to setup interface controls');
    }
  }

  // Update slider progress fill
  updateSliderProgress(slider) {
    const value = parseFloat(slider.value);
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const percentage = ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--slider-progress', `${percentage}%`);

    // Add visual feedback for EQ sliders when value is non-zero
    if (slider.parentElement && slider.parentElement.classList.contains('equalizer')) {
      // For EQ sliders, mark as active if value is not 0 (considering float precision)
      const isActive = Math.abs(value) > 0.1;
      slider.setAttribute('data-active', isActive.toString());
    }
  }

  // Initialize all slider progress on load
  initializeSliderProgress() {
    // Initialize EQ sliders progress
    this.eqSliders.forEach((slider) => {
      if (slider) {
        this.updateSliderProgress(slider);
      }
    });

    // Initialize control sliders progress
    this.updateSliderProgress(this.volumeSlider);
    this.updateSliderProgress(this.bassSlider);
    this.updateSliderProgress(this.voiceSlider);
    this.updateSliderProgress(this.audio8dSpeedSlider);
    this.updateSliderProgress(this.surroundDepthSlider);
  }

  // Check if equalizer values have changed from defaults
  checkEqualizerReset() {
    const currentValues = this.eqSliders.map((slider) => parseFloat(slider.value));
    const hasChanged = currentValues.some(
      (value, index) => value !== this.defaults.equalizer[index]
    );
    const resetBtn = document.getElementById('reset-eq');
    resetBtn.classList.toggle('active', hasChanged);
  }

  // Check if audio control values have changed from defaults
  checkAudioReset() {
    const hasChanged =
      parseFloat(this.volumeSlider.value) !== this.defaults.audio.volume ||
      parseFloat(this.bassSlider.value) !== this.defaults.audio.bass ||
      parseFloat(this.voiceSlider.value) !== this.defaults.audio.voice;

    const resetBtn = document.getElementById('reset-audio');
    resetBtn.classList.toggle('active', hasChanged);
  }

  // Check if effects values have changed from defaults
  checkEffectsReset() {
    const hasChanged =
      parseFloat(this.audio8dSpeedSlider.value) !== this.defaults.effects.audio8dSpeed ||
      parseFloat(this.surroundDepthSlider.value) !== this.defaults.effects.surroundDepth ||
      this.audio8dToggle.classList.contains('active') !== this.defaults.effects.audio8dActive ||
      this.surroundToggle.classList.contains('active') !== this.defaults.effects.surroundActive ||
      this.echoToggle.classList.contains('active') !== this.defaults.effects.echoActive;

    const resetBtn = document.getElementById('reset-effects');
    resetBtn.classList.toggle('active', hasChanged);
  }

  // Sidebar methods
  openSidebar() {
    // Close any open dropdown first
    if (this.toggleCustomDropdown) {
      this.toggleCustomDropdown(false);
    }
    
    if (this.sidebar && this.sidebarOverlay) {
      this.sidebar.classList.add('active');
      this.sidebarOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      
      // Rotate settings cog
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
      
      // Rotate settings cog back to normal
      if (this.settingsToggle) {
        this.settingsToggle.classList.remove('active');
      }
    }
  }

  // Tabs sidebar methods
  openTabsSidebar() {
    // Close any open dropdown first
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

  // Theme methods
  toggleTheme() {
    const body = document.body;
    const isLight = body.classList.contains('light-theme');

    if (isLight) {
      // Switch to dark
      body.classList.remove('light-theme');
      localStorage.setItem('auris-theme', 'dark');
    } else {
      // Switch to light
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

  // External link methods
  openReviewLink() {
    // Placeholder URL for Chrome Web Store reviews
    // Replace with actual Chrome Web Store URL when published
    const reviewUrl = 'https://chromewebstore.google.com/detail/auris-audio-equalizer/placeholder-id/reviews';
    chrome.tabs.create({ url: reviewUrl });
  }

  openIssueLink() {
    // GitHub new issue URL
    const issueUrl = 'https://github.com/nnilayy/Auris/issues/new';
    chrome.tabs.create({ url: issueUrl });
  }

  updateEqualizer() {
    const eqValues = this.eqSliders.map((slider) => parseFloat(slider.value));
    // Previous path
    this.sendMessageToContent({ type: 'updateEqualizer', values: eqValues });

    // Capture path (Phase 3): send updateEQ event
    import('../scripts/common/featureFlags.js')
      .then((mod) => {
        if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) {
              return;
            }
            chrome.runtime.sendMessage(
              {
                event: 'updateEQ',
                tabId: tab.id,
                settings: undefined, // not needed here
                eq: eqValues,
              },
              (resp) => {
                if (resp && resp.ok) {
                  // optional debug log
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
    };

    this.sendMessageToContent({
      type: 'updateEffectSettings',
      settings: effectSettings,
    });
    // Capture path (Phase 5): updateEffectParams for 8D speed + surround depth
    import('../scripts/common/featureFlags.js')
      .then((mod) => {
        if (mod.isCaptureEnabled && mod.isCaptureEnabled()) {
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

        // Update value displays
        this.volumeValue.textContent = this.volumeSlider.value + '%';
        this.bassValue.textContent = this.bassSlider.value + 'dB';
        this.voiceValue.textContent = this.voiceSlider.value + 'dB';
        this.audio8dSpeedValue.textContent = this.audio8dSpeedSlider.value + 's';
        this.surroundDepthValue.textContent = this.surroundDepthSlider.value + '%';

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

        // Apply settings
        this.updateEqualizer();
        this.updateAudioSettings();
        this.updateEffectSettings();

        // Send toggle states to content script
        if (settings.audio8d) {
          this.sendMessageToContent({
            type: 'toggle8dAudio',
            enabled: true,
          });
        }
        if (settings.surround) {
          this.sendMessageToContent({
            type: 'toggleSurroundSound',
            enabled: true,
          });
        }
        if (settings.echo) {
          this.sendMessageToContent({
            type: 'toggleEcho',
            enabled: true,
          });
        }

        // Check reset button states after loading
        this.checkEqualizerReset();
        this.checkAudioReset();
        this.checkEffectsReset();
      }
    } catch (error) {
      // Log settings loading errors for debugging
      console.error('Auris: Failed to load settings from storage:', error);

      // Apply default values and check reset buttons for default state
      this.checkEqualizerReset();
      this.checkAudioReset();
      this.checkEffectsReset();

      // Show warning in status
      if (this.statusElement) {
        this.statusElement.textContent = 'Using default settings';
        this.statusElement.className = 'status warning';
      }
    }
  }

  resetEqualizer() {
    // Reset all EQ sliders to 0
    this.eqSliders.forEach((slider) => {
      slider.value = 0;
      // Update the progress trail for each slider
      this.updateSliderProgress(slider);
    });

    // Reset preset dropdown to "Flat" (default preset)
    if (this.presetSelect) {
      this.presetSelect.value = 'flat';
      
      // Update custom dropdown display text
      if (this.customSelectTrigger) {
        this.customSelectTrigger.textContent = 'Flat';
      }
      
      // Update selected option styling
      if (this.customSelectOptions) {
        this.customSelectOptions.querySelectorAll('.custom-select-option').forEach((opt) => {
          opt.classList.remove('selected');
          if (opt.dataset.value === 'flat') {
            opt.classList.add('selected');
          }
        });
      }
    }

    // Apply the reset values
    this.updateEqualizer();
    this.saveSettings();
  }

  resetAudioControls() {
    // Reset audio controls to defaults
    this.volumeSlider.value = 100;
    this.bassSlider.value = 0;
    this.voiceSlider.value = 0;

    // Update value displays
    this.volumeValue.textContent = '100%';
    this.bassValue.textContent = '0dB';
    this.voiceValue.textContent = '0dB';

    // Update slider progress trails
    this.updateSliderProgress(this.volumeSlider);
    this.updateSliderProgress(this.bassSlider);
    this.updateSliderProgress(this.voiceSlider);

    // Apply the reset values
    this.updateAudioSettings();
    this.saveSettings();
  }

  resetEffects() {
    // Reset effect controls to defaults
    this.audio8dSpeedSlider.value = 3;
    this.surroundDepthSlider.value = 50;

    // Update value displays
    this.audio8dSpeedValue.textContent = '3s';
    this.surroundDepthValue.textContent = '50%';

    // Update slider progress trails
    this.updateSliderProgress(this.audio8dSpeedSlider);
    this.updateSliderProgress(this.surroundDepthSlider);

    // Turn off effects
    this.audio8dToggle.classList.remove('active');
    this.surroundToggle.classList.remove('active');
    this.echoToggle.classList.remove('active');

    // Reset preset to flat
    this.presetSelect.value = 'flat';

    // Apply the reset values (updates params for 8D speed + surround depth)
    this.updateEffectSettings();

    // Capture path: toggle all effects OFF in the active tab
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

  showSection(sectionName) {
    // Hide all sections
    document.querySelectorAll('.section-content').forEach((section) => {
      section.classList.add('hidden');
    });

    // Remove active class from all nav buttons
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.remove('active');
    });

    // Show selected section
    document.getElementById(`section-${sectionName}`).classList.remove('hidden');

    // Activate corresponding nav button
    document.getElementById(`nav-${sectionName}`).classList.add('active');
  }

  // ===== ERROR HANDLING =====
  handleCriticalError(message) {
    try {
      // Try to display error in popup body
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
      // Last resort
      console.error('Auris: Critical error handler failed:', error);
    }
  }

  showErrorState(message) {
    try {
      // Try to show error in status element
      if (this.statusElement) {
        this.statusElement.textContent = `${message}`;
        this.statusElement.className = 'status error';
      }

      // Also log to console for debugging
      console.error('Auris Popup Error:', message);

      // Try to show a fallback error in the popup body
      const errorDiv = document.createElement('div');
      errorDiv.className = 'popup-error';
      errorDiv.innerHTML = `
                <div style="color: #ff4444; text-align: center; padding: 10px; font-size: 12px;">
                    ${message}
                </div>
            `;

      // Insert at top of popup if possible
      const popupBody = document.querySelector('.popup-container') || document.body;
      if (popupBody && !document.querySelector('.popup-error')) {
        popupBody.insertBefore(errorDiv, popupBody.firstChild);
      }
    } catch (error) {
      // Last resort - just log to console
      console.error('Auris: Critical error - could not display error state:', error);
    }
  }

  // ===== CUSTOM DROPDOWN =====
  initializeCustomDropdown() {
    // Create custom dropdown structure
    this.createCustomDropdown();

    // Set up event listeners
    this.setupCustomDropdownEvents();
  }

  createCustomDropdown() {
    const controlRow = this.presetSelect.parentElement;
    const selectLabel = controlRow.querySelector('.control-label');

    // Hide original select
    this.presetSelect.style.display = 'none';

    // Create custom dropdown container
    const customContainer = document.createElement('div');
    customContainer.className = 'custom-select-container';

    // Create trigger button
    const trigger = document.createElement('button');
    trigger.className = 'custom-select-trigger';
    trigger.type = 'button';
    trigger.textContent = this.presetSelect.options[this.presetSelect.selectedIndex].text;

    // Create options container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-select-options';

    // Create options
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

    // Create blur overlay
    const blurOverlay = document.createElement('div');
    blurOverlay.className = 'dropdown-blur-overlay';

    // Assemble custom dropdown
    customContainer.appendChild(trigger);
    customContainer.appendChild(optionsContainer);

    // Insert after label
    controlRow.insertBefore(customContainer, this.presetSelect);
    document.body.appendChild(blurOverlay);

    // Store references
    this.customSelectTrigger = trigger;
    this.customSelectOptions = optionsContainer;
    this.customSelectContainer = customContainer;
    this.dropdownBlurOverlay = blurOverlay;
  }

  setupCustomDropdownEvents() {
    let isOpen = false;

    // Toggle dropdown
    this.customSelectTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCustomDropdown(!isOpen);
      isOpen = !isOpen;
    });

    // Option selection
    this.customSelectOptions.addEventListener('click', (e) => {
      if (e.target.classList.contains('custom-select-option')) {
        const selectedValue = e.target.dataset.value;
        const selectedText = e.target.textContent;

        // Update trigger text
        this.customSelectTrigger.textContent = selectedText;

        // Update original select
        this.presetSelect.value = selectedValue;

        // Update selected option styling
        this.customSelectOptions.querySelectorAll('.custom-select-option').forEach((opt) => {
          opt.classList.remove('selected');
        });
        e.target.classList.add('selected');

        // Apply preset
        this.applyPreset(selectedValue);

        // Close dropdown
        this.toggleCustomDropdown(false);
        isOpen = false;
      }
    });

    // Close on blur overlay click
    this.dropdownBlurOverlay.addEventListener('click', () => {
      this.toggleCustomDropdown(false);
      isOpen = false;
    });

    // Close on escape key
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

  // ===== CLEANUP =====
  cleanup() {
    // Clear debounce timeouts to prevent memory leaks (only for volume/bass/voice controls)
    clearTimeout(this.volumeUpdateTimeout);
    clearTimeout(this.bassUpdateTimeout);
    clearTimeout(this.voiceUpdateTimeout);

    console.log('Auris Popup: Cleanup completed');
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const aurisPopup = new AurisPopup();

  // Cleanup when popup is closed/unloaded
  window.addEventListener('beforeunload', () => {
    aurisPopup.cleanup();
  });

  // Also cleanup when popup loses focus (Chrome extension popup behavior)
  window.addEventListener('blur', () => {
    aurisPopup.cleanup();
  });
});
