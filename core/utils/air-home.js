"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAirHome = getAirHome;
exports.ensureAirHome = ensureAirHome;
exports.getDatabasePath = getDatabasePath;
exports.getConfigPath = getConfigPath;
exports.getExportsPath = getExportsPath;
exports.getSessionMapsPath = getSessionMapsPath;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function getAirHome() {
    return path.join(os.homedir(), '.air');
}
function ensureAirHome() {
    const home = getAirHome();
    if (!fs.existsSync(home)) {
        fs.mkdirSync(home, { recursive: true });
    }
}
function getDatabasePath() {
    if (process.env.AIR_DB_PATH) {
        return process.env.AIR_DB_PATH;
    }
    return path.join(getAirHome(), 'air-data.db');
}
function getConfigPath() {
    return path.join(getAirHome(), 'config.json');
}
function getExportsPath() {
    const exportsPath = path.join(getAirHome(), 'exports');
    if (!fs.existsSync(exportsPath)) {
        fs.mkdirSync(exportsPath, { recursive: true });
    }
    return exportsPath;
}
function getSessionMapsPath() {
    const sessionMapsPath = path.join(getAirHome(), 'session-maps');
    if (!fs.existsSync(sessionMapsPath)) {
        fs.mkdirSync(sessionMapsPath, { recursive: true });
    }
    return sessionMapsPath;
}
