'use strict';

import '../shared/utils.js';
import '../shared/theme.js';
import '../desktop.js';
import './contextual-help.js';
import './queue.js';
import './songs.js';
import { initGiftCatalogUpdateToast } from './gifts/catalog-update-toast.js';
import { initGiftInteractionControls } from './gifts/interaction-controls.js';
import './gifts/index.js';
import './gift-frame.js';
import { initFanProfiles } from './fans/index.js';
import { initFanProfileAutoUpdate } from './fans/automatic-update.js';
import './app.js';
initGiftCatalogUpdateToast();
initGiftInteractionControls();
initFanProfiles();
initFanProfileAutoUpdate();
