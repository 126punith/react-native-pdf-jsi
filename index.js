/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * Enhanced version with JSI integration for high-performance PDF operations
 * 
 * Original work Copyright (c) 2017-present, Wonday (@wonday.org)
 * All rights reserved.
 *
 * This source code is licensed under the MIT-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';
import React, {Component} from 'react';
import PropTypes from 'prop-types';
import {
    View,
    Platform,
    StyleSheet,
    Image,
    Text,
    NativeModules,
    requireNativeComponent
} from 'react-native';
// Codegen component variables - will be loaded lazily to prevent hooks errors
let PdfViewNativeComponent = null;
let PdfViewCommands = null;
import ReactNativeBlobUtil from 'react-native-blob-util'
import {ViewPropTypes} from 'deprecated-react-native-prop-types';
const SHA1 = require('crypto-js/sha1');
import PdfView from './PdfView';
import PDFJSI, { searchTextDirect } from './src/PDFJSI';

export default class Pdf extends Component {

    static propTypes = {
        ...ViewPropTypes,
        source: PropTypes.oneOfType([
            PropTypes.shape({
                uri: PropTypes.string,
                cache: PropTypes.bool,
                cacheFileName: PropTypes.string,
                expiration: PropTypes.number,
            }),
            // Opaque type returned by require('./test.pdf')
            PropTypes.number,
        ]).isRequired,
        page: PropTypes.number,
        scale: PropTypes.number,
        minScale: PropTypes.number,
        maxScale: PropTypes.number,
        horizontal: PropTypes.bool,
        spacing: PropTypes.number,
        password: PropTypes.string,
        renderActivityIndicator: PropTypes.func,
        enableAntialiasing: PropTypes.bool,
        enableAnnotationRendering: PropTypes.bool,
        showsHorizontalScrollIndicator: PropTypes.bool,
        showsVerticalScrollIndicator: PropTypes.bool,
        scrollEnabled: PropTypes.bool,
        enablePaging: PropTypes.bool,
        enableRTL: PropTypes.bool,
        fitPolicy: PropTypes.number,
        trustAllCerts: PropTypes.bool,
        singlePage: PropTypes.bool,
        onLoadComplete: PropTypes.func,
        onPageChanged: PropTypes.func,
        onError: PropTypes.func,
        onPageSingleTap: PropTypes.func,
        onScaleChanged: PropTypes.func,
        onPressLink: PropTypes.func,
        pdfId: PropTypes.string,
        highlightRects: PropTypes.arrayOf(PropTypes.shape({ page: PropTypes.number.isRequired, rect: PropTypes.string.isRequired })),

        // Props that are not available in the earlier react native version, added to prevent crashed on android
        accessibilityLabel: PropTypes.string,
        importantForAccessibility: PropTypes.string,
        renderToHardwareTextureAndroid: PropTypes.string,
        testID: PropTypes.string,
        onLayout: PropTypes.bool,
        accessibilityLiveRegion: PropTypes.string,
        accessibilityComponentType: PropTypes.string,
    };

    static defaultProps = {
        password: "",
        scale: 1,
        minScale: 1,
        maxScale: 3,
        spacing: 10,
        fitPolicy: 2, //fit both
        horizontal: false,
        page: 1,
        enableAntialiasing: true,
        enableAnnotationRendering: true,
        showsHorizontalScrollIndicator: true,
        showsVerticalScrollIndicator: true,
        scrollEnabled: true,
        enablePaging: false,
        enableRTL: false,
        trustAllCerts: false,
        usePDFKit: true,
        singlePage: false,
        onLoadProgress: (percent) => {
        },
        onLoadComplete: (numberOfPages, path) => {
        },
        onPageChanged: (page, numberOfPages) => {
        },
        onError: (error) => {
        },
        onPageSingleTap: (page, x, y) => {
        },
        onScaleChanged: (scale) => {
        },
        onPressLink: (url) => {
        },
        pdfId: undefined,
        highlightRects: undefined,
    };

    constructor(props) {

        super(props);
        this.state = {
            path: '',
            isDownloaded: false,
            progress: 0,
            jsiAvailable: false,
        };

        // Store downloaded file path in instance variable for immediate access
        // This ensures path is available when onLoadComplete fires, even before state updates
        this.downloadedFilePath = '';
        // Stable per-instance id for JSI calls when props.pdfId is not set (#13 / setPage)
        this._instancePdfId = `pdf_inst_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        this.lastRNBFTask = null;
        this.pdfJSI = PDFJSI;
        this.initializeJSI();

    }

    initializeJSI = async () => {
        try {
            const isAvailable = await this.pdfJSI.checkJSIAvailability();
            if (this._mounted) {
                this.setState({ jsiAvailable: isAvailable });
            }
            if (isAvailable) {
                console.log('🚀 PDFJSI: High-performance JSI mode enabled');
            } else {
                console.log('📱 PDFJSI: Using standard bridge mode');
            }
        } catch (error) {
            console.warn('PDFJSI: Failed to initialize JSI', error);
        }
    };

    componentDidUpdate(prevProps) {

        const nextSource = Image.resolveAssetSource(this.props.source);
        const curSource = Image.resolveAssetSource(prevProps.source);

        if ((nextSource.uri !== curSource.uri)) {
            // if has download task, then cancel it.
            if (this.lastRNBFTask && this.lastRNBFTask.cancel) {
                this.lastRNBFTask.cancel(err => {
                    this._loadFromSource(this.props.source);
                });
                this.lastRNBFTask = null;
            } else {
                this._loadFromSource(this.props.source);
            }
        }

        // #13: Same URI but `page` prop changed — force native navigation (lists / controlled page)
        const uriUnchanged = nextSource.uri === curSource.uri;
        if (
            uriUnchanged &&
            this.state.isDownloaded &&
            prevProps.page !== this.props.page
        ) {
            const p = Number(this.props.page);
            if (Number.isFinite(p) && p >= 1) {
                try {
                    this.setPage(p);
                } catch (e) {
                    if (__DEV__) {
                        console.warn('[Pdf] componentDidUpdate setPage failed:', e);
                    }
                }
            }
        }
    }

    componentDidMount() {
        this._mounted = true;
        this._loadFromSource(this.props.source);
    }

    componentWillUnmount() {
        this._mounted = false;
        if (this.lastRNBFTask) {
            // this.lastRNBFTask.cancel(err => {
            // });
            this.lastRNBFTask = null;
        }

    }

    _loadFromSource = (newSource) => {

        const source = Image.resolveAssetSource(newSource) || {};

        let uri = source.uri || '';
        // first set to initial state
        this.downloadedFilePath = ''; // Reset instance variable
        if (this._mounted) {
            this.setState({isDownloaded: false, path: '', progress: 0});
        }
        const filename = source.cacheFileName || SHA1(uri) + '.pdf';
        const cacheFile = ReactNativeBlobUtil.fs.dirs.CacheDir + '/' + filename;

        if (source.cache) {
            ReactNativeBlobUtil.fs
                .stat(cacheFile)
                .then(stats => {
                    if (!Boolean(source.expiration) || (source.expiration * 1000 + stats.lastModified) > (new Date().getTime())) {
                        // Store in instance variable immediately for onLoadComplete callback
                        this.downloadedFilePath = cacheFile;
                        if (this._mounted) {
                            this.setState({path: cacheFile, isDownloaded: true});
                        }
                    } else {
                        // cache expirated then reload it
                        this._prepareFile(source);
                    }
                })
                .catch(() => {
                    this._prepareFile(source);
                })

        } else {
            this._prepareFile(source);
        }
    };

    _prepareFile = async (source) => {

        try {
            if (source.uri) {
                let uri = source.uri || '';

                const isNetwork = !!(uri && uri.match(/^https?:\/\//));
                const isAsset = !!(uri && uri.match(/^bundle-assets:\/\//));
                const isBase64 = !!(uri && uri.match(/^data:application\/pdf;base64/));

                const filename = source.cacheFileName || SHA1(uri) + '.pdf';
                const cacheFile = ReactNativeBlobUtil.fs.dirs.CacheDir + '/' + filename;

                // delete old cache file
                this._unlinkFile(cacheFile);

                if (isNetwork) {
                    this._downloadFile(source, cacheFile);
                } else if (isAsset) {
                    ReactNativeBlobUtil.fs
                        .cp(uri, cacheFile)
                        .then(() => {
                            // Store in instance variable immediately for onLoadComplete callback
                            this.downloadedFilePath = cacheFile;
                            if (this._mounted) {
                                this.setState({path: cacheFile, isDownloaded: true, progress: 1});
                            }
                        })
                        .catch(async (error) => {
                            this._unlinkFile(cacheFile);
                            this._onError(error);
                        })
                } else if (isBase64) {
                    let data = uri.replace(/data:application\/pdf;base64,/i, '');
                    ReactNativeBlobUtil.fs
                        .writeFile(cacheFile, data, 'base64')
                        .then(() => {
                            // Store in instance variable immediately for onLoadComplete callback
                            this.downloadedFilePath = cacheFile;
                            if (this._mounted) {
                                this.setState({path: cacheFile, isDownloaded: true, progress: 1});
                            }
                        })
                        .catch(async (error) => {
                            this._unlinkFile(cacheFile);
                            this._onError(error)
                        });
                } else {
                    // Local file path
                    const localPath = decodeURIComponent(uri.replace(/file:\/\//i, ''));
                    // Store in instance variable immediately for onLoadComplete callback
                    this.downloadedFilePath = localPath;
                    if (this._mounted) {
                       this.setState({
                            path: localPath,
                            isDownloaded: true,
                        });
                    }
                }
            } else {
                this._onError(new Error('no pdf source!'));
            }
        } catch (e) {
            this._onError(e)
        }


    };

    _downloadFile = async (source, cacheFile) => {

        if (this.lastRNBFTask) {
            this.lastRNBFTask.cancel(err => {
            });
            this.lastRNBFTask = null;
        }

        const tempCacheFile = cacheFile + '.tmp';
        this._unlinkFile(tempCacheFile);

        // Ensure cache directory exists before downloading
        const cacheDir = ReactNativeBlobUtil.fs.dirs.CacheDir;
        try {
            const dirExists = await ReactNativeBlobUtil.fs.exists(cacheDir);
            if (!dirExists) {
                await ReactNativeBlobUtil.fs.mkdir(cacheDir);
            }
        } catch (error) {
            console.warn('Failed to ensure cache directory exists:', error);
            // Continue anyway - ReactNativeBlobUtil might handle it
        }

        // Build config object - conditionally include trusty based on URL protocol and trustAllCerts
        const isHttps = source.uri && source.uri.startsWith('https://');
        const config = {
            path: tempCacheFile,
        };
        
        // Only include trusty option for HTTPS URLs and only if trustAllCerts is explicitly true
        // For HTTP URLs, never include trusty option to avoid trust manager errors
        if (isHttps && this.props.trustAllCerts === true) {
            config.trusty = true;
        }
        // For HTTP or when trustAllCerts is false, omit trusty option entirely

        this.lastRNBFTask = ReactNativeBlobUtil.config(config)
            .fetch(
                source.method ? source.method : 'GET',
                source.uri,
                source.headers ? source.headers : {},
                source.body ? source.body : ""
            )
            // listen to download progress event
            .progress((received, total) => {
                this.props.onLoadProgress && this.props.onLoadProgress(received / total);
                if (this._mounted) {
                    this.setState({progress: received / total});
                }
            })
            .catch(async (error) => {
                this._onError(error);
            });

        this.lastRNBFTask
            .then(async (res) => {

                this.lastRNBFTask = null;

                if (res && res.respInfo && res.respInfo.headers && !res.respInfo.headers["Content-Encoding"] && !res.respInfo.headers["Transfer-Encoding"] && res.respInfo.headers["Content-Length"]) {
                    const expectedContentLength = res.respInfo.headers["Content-Length"];
                    let actualContentLength;

                    try {
                        const fileStats = await ReactNativeBlobUtil.fs.stat(res.path());

                        if (!fileStats || !fileStats.size) {
                            throw new Error("FileNotFound:" + source.uri);
                        }

                        actualContentLength = fileStats.size;
                    } catch (error) {
                        throw new Error("DownloadFailed:" + source.uri);
                    }

                    if (expectedContentLength != actualContentLength) {
                        throw new Error("DownloadFailed:" + source.uri);
                    }
                }

                this._unlinkFile(cacheFile);
                ReactNativeBlobUtil.fs
                    .cp(tempCacheFile, cacheFile)
                    .then(() => {
                        // Store in instance variable immediately for onLoadComplete callback
                        // This ensures path is available even if state hasn't updated yet
                        this.downloadedFilePath = cacheFile;
                        if (this._mounted) {
                            this.setState({path: cacheFile, isDownloaded: true, progress: 1});
                        }
                        this._unlinkFile(tempCacheFile);
                    })
                    .catch(async (error) => {
                        throw error;
                    });
            })
            .catch(async (error) => {
                this._unlinkFile(tempCacheFile);
                this._unlinkFile(cacheFile);
                this._onError(error);
            });

    };

    _unlinkFile = async (file) => {
        try {
            await ReactNativeBlobUtil.fs.unlink(file);
        } catch (e) {

        }
    }

    setNativeProps = nativeProps => {
        if (this._root){
            this._root.setNativeProps(nativeProps);
        }
    };

    // Public method to get the current PDF file path
    getPath() {
        // Return instance variable first (most reliable), then state path
        return this.downloadedFilePath || this.state.path || '';
    }

    setPage( pageNumber ) {
        if ( (pageNumber === null) || (isNaN(pageNumber)) ) {
            throw new Error('Specified pageNumber is not a number');
        }
        
        // Use JSI only with a stable id (props.pdfId or per-mount instance id — not a new random id per call)
        const pdfIdForJsi = this.props.pdfId || this._instancePdfId;
        if (this.state.jsiAvailable && this.state.path && pdfIdForJsi) {
            try {
                this.pdfJSI.setCurrentPage(pdfIdForJsi, pageNumber);
                if (__DEV__) {
                    console.log(`🚀 JSI: Set page ${pageNumber} for PDF ${pdfIdForJsi}`);
                }
            } catch (error) {
                console.warn('JSI setPage failed, falling back to standard method:', error);
            }
        }
        
        if (!!global?.nativeFabricUIManager ) {
            if (this._root) {
                // Lazy load PdfViewCommands if not already loaded
                if (!PdfViewCommands) {
                    try {
                        const codegenModule = require('./fabric/RNPDFPdfNativeComponent');
                        PdfViewCommands = codegenModule.Commands;
                    } catch (error) {
                        console.warn('PdfViewCommands not available:', error);
                        return;
                    }
                }
                PdfViewCommands.setNativePage(
                    this._root,
                    pageNumber,
                );
            }
          } else {
            this.setNativeProps({
                page: pageNumber
            });
          }
        
    }

    // 🚀 JSI Enhanced Methods
    
    generatePdfId = () => {
        // Generate a unique ID for this PDF instance
        return `pdf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    };

    // Enhanced page rendering with JSI
    renderPageWithJSI = async (pageNumber, scale = 1.0) => {
        if (!this.state.jsiAvailable || !this.state.path) {
            console.warn('JSI not available, using standard rendering');
            return null;
        }

        try {
            const pdfId = this.generatePdfId();
            const result = await this.pdfJSI.renderPageDirect(
                pdfId,
                pageNumber,
                scale,
                this.state.path
            );
            console.log(`🚀 JSI: Rendered page ${pageNumber} in ${result.renderTimeMs}ms`);
            return result;
        } catch (error) {
            console.error('JSI renderPageDirect failed:', error);
            return null;
        }
    };

    // Get page metrics via JSI
    getPageMetricsWithJSI = async (pageNumber) => {
        if (!this.state.jsiAvailable) {
            return null;
        }

        try {
            const pdfId = this.generatePdfId();
            return await this.pdfJSI.getPageMetrics(pdfId, pageNumber);
        } catch (error) {
            console.error('JSI getPageMetrics failed:', error);
            return null;
        }
    };

    // Preload pages via JSI
    preloadPagesWithJSI = async (startPage, endPage) => {
        if (!this.state.jsiAvailable) {
            return false;
        }

        try {
            const pdfId = this.generatePdfId();
            const success = await this.pdfJSI.preloadPagesDirect(pdfId, startPage, endPage);
            console.log(`🚀 JSI: Preloaded pages ${startPage}-${endPage}: ${success}`);
            return success;
        } catch (error) {
            console.error('JSI preloadPagesDirect failed:', error);
            return false;
        }
    };

    // Get JSI performance metrics
    getJSIPerformanceMetrics = async () => {
        if (!this.state.jsiAvailable) {
            return null;
        }

        try {
            const pdfId = this.generatePdfId();
            return await this.pdfJSI.getPerformanceMetrics(pdfId);
        } catch (error) {
            console.error('JSI getPerformanceMetrics failed:', error);
            return null;
        }
    };

    // Get JSI stats
    getJSIStats = async () => {
        if (!this.state.jsiAvailable) {
            return null;
        }

        try {
            return await this.pdfJSI.getJSIStats();
        } catch (error) {
            console.error('JSI getJSIStats failed:', error);
            return null;
        }
    };

    _onChange = (event) => {

        let message = event.nativeEvent.message.split('|');
        if (__DEV__) {
            console.log("📥 [Pdf] onChange received:", message[0], "full message:", event.nativeEvent.message);
        }
        if (message.length > 0) {
            if (message[0] === 'loadComplete') {
                if (__DEV__) {
                    console.log("📥 [Pdf] Processing loadComplete event");
                }
                let tableContents;
                let filePath;
                
                // Handle both old format (without path) and new format (with path)
                // Old format: loadComplete|pages|width|height|tableContents
                // New format: loadComplete|pages|width|height|path|tableContents
                
                // First, check if we have the new format (6+ parts before splice)
                const originalLength = message.length;
                const hasPath = originalLength >= 6;
                
                if (hasPath) {
                    // New format: extract path from message[4], rest is tableContents
                    filePath = message[4] || '';
                    // Join everything after path (index 5+) as tableContents JSON
                    const tableContentsStr = message.slice(5).join('|');
                    try {
                        tableContents = tableContentsStr && JSON.parse(tableContentsStr);
                    } catch(e) {
                        tableContents = tableContentsStr;
                    }
                } else {
                    // Old format: no path, everything after height (index 4+) is tableContents
                    filePath = this.downloadedFilePath || this.state.path || '';
                    // Handle old splice logic for tableContents that might contain |
                    if (originalLength > 5) {
                        message[4] = message.splice(4).join('|');
                    }
                    try {
                        tableContents = message[4] && JSON.parse(message[4]);
                    } catch(e) {
                        tableContents = message[4];
                    }
                }
                
                // Final fallback: use instance variable or state if path from native is empty
                if (!filePath || filePath.trim() === '') {
                    filePath = this.downloadedFilePath || this.state.path || '';
                }
                // Register path for search (iOS: ensures SearchRegistry has path when pdfId may not reach native view)
                if (this.props.pdfId && filePath) {
                    const PDFJSIManager = NativeModules.PDFJSIManager;
                    if (PDFJSIManager && typeof PDFJSIManager.registerPathForSearch === 'function') {
                        if (__DEV__) {
                            console.log('📌 [Pdf] Registering path for search:', this.props.pdfId, 'pathLength:', filePath.length);
                        }
                        PDFJSIManager.registerPathForSearch(this.props.pdfId, filePath).then(() => {
                            if (__DEV__) console.log('✅ [Pdf] Path registered for search:', this.props.pdfId);
                        }).catch((err) => {
                            if (__DEV__) console.warn('⚠️ [Pdf] registerPathForSearch failed:', err);
                        });
                    } else if (__DEV__) {
                        console.warn('⚠️ [Pdf] PDFJSIManager.registerPathForSearch not available');
                    }
                } else if (__DEV__) {
                    console.log('📌 [Pdf] Skip path registration: pdfId=', this.props.pdfId, 'hasPath=', !!filePath);
                }
                // Log path extraction for debugging
                if (__DEV__) {
                    console.log('📁 [Pdf] loadComplete - Path extraction:', {
                        originalMessageLength: originalLength,
                        hasPathInMessage: hasPath,
                        fromNativeMessage: hasPath ? (message[4] || 'empty') : 'not in message',
                        fromInstance: this.downloadedFilePath || 'empty',
                        fromState: this.state.path || 'empty',
                        final: filePath || 'empty',
                    });
                }
                
                // Always call onLoadComplete callback
                if (this.props.onLoadComplete) {
                    console.log('📁 [Pdf] Calling onLoadComplete callback with:', {
                        pages: Number(message[1]),
                        path: filePath,
                        width: Number(message[2]),
                        height: Number(message[3]),
                    });
                    this.props.onLoadComplete(Number(message[1]), filePath, {
                        width: Number(message[2]),
                        height: Number(message[3]),
                    },
                    tableContents
                    );
                } else {
                    console.warn('⚠️ [Pdf] onLoadComplete callback not provided');
                }
            } else if (message.length > 5) {
                // Only apply splice logic for non-loadComplete messages
                message[4] = message.splice(4).join('|');
            } else if (message[0] === 'pageChanged') {
                this.props.onPageChanged && this.props.onPageChanged(Number(message[1]), Number(message[2]));
            } else if (message[0] === 'error') {
                this._onError(new Error(message[1]));
            } else if (message[0] === 'pageSingleTap') {
                this.props.onPageSingleTap && this.props.onPageSingleTap(Number(message[1]), Number(message[2]), Number(message[3]));
            } else if (message[0] === 'scaleChanged') {
                this.props.onScaleChanged && this.props.onScaleChanged(Number(message[1]));
            } else if (message[0] === 'linkPressed') {
                this.props.onPressLink && this.props.onPressLink(message[1]);
            }
        }

    };

    _onError = (error) => {

        this.props.onError && this.props.onError(error);

    };

    render() {
        if (Platform.OS === "android" || Platform.OS === "ios" || Platform.OS === "windows") {
                return (
                    <View style={[this.props.style,{overflow: 'hidden'}]}>
                        {!this.state.isDownloaded?
                            (<View
                                style={[styles.progressContainer, this.props.progressContainerStyle]}
                            >
                                {this.props.renderActivityIndicator
                                    ? this.props.renderActivityIndicator(this.state.progress)
                                    : <Text>{`${(this.state.progress * 100).toFixed(2)}%`}</Text>}
                            </View>):(
                                Platform.OS === "android" || Platform.OS === "windows"?(
                                        <PdfCustom
                                            ref={component => (this._root = component)}
                                            {...this.props}
                                            style={[{flex:1,backgroundColor: '#EEE'}, this.props.style]}
                                            path={this.state.path}
                                            onChange={this._onChange}
                                        />
                                    ):(
                                        this.props.usePDFKit ?(
                                                <PdfCustom
                                                    ref={component => (this._root = component)}
                                                    {...this.props}
                                                    style={[{backgroundColor: '#EEE',overflow: 'hidden'}, this.props.style]}
                                                    path={this.state.path}
                                                    onChange={this._onChange}
                                                />
                                            ):(<PdfView
                                                {...this.props}
                                                style={[{backgroundColor: '#EEE',overflow: 'hidden'}, this.props.style]}
                                                path={this.state.path}
                                                page={this.props.page}
                                                onLoadComplete={this.props.onLoadComplete}
                                                onPageChanged={this.props.onPageChanged}
                                                onError={this._onError}
                                                onPageSingleTap={this.props.onPageSingleTap}
                                                onScaleChanged={this.props.onScaleChanged}
                                                onPressLink={this.props.onPressLink}
                                            />)
                                    )
                                )}
                    </View>);
        } else {
            return (null);
        }


    }
}

if (Platform.OS === "android" || Platform.OS === "ios") {
    // Load codegen component immediately - it should work after React is initialized
    try {
        const codegenModule = require('./fabric/RNPDFPdfNativeComponent');
        const CodegenComponent = codegenModule.default;
        PdfViewNativeComponent = CodegenComponent;
        PdfViewCommands = codegenModule.Commands;
        var PdfCustom = CodegenComponent;
    } catch (error) {
        console.warn('Failed to load codegen component, using fallback:', error);
        // Use the correct native component name for Android/iOS
        var PdfCustom = requireNativeComponent('RNPDFPdfView', Pdf, {
            nativeOnly: {path: true, onChange: true},
        });
    }
}  else if (Platform.OS === "windows") {
    var PdfCustom = requireNativeComponent('RCTPdf', Pdf, {
        nativeOnly: {path: true, onChange: true},
    })
}

const styles = StyleSheet.create({
    progressContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center'
    },
    progressBar: {
        width: 200,
        height: 2
    }
});

// ========================================
// TIER 2: Low-Level API (Managers)
// ========================================

import ExportManager from './src/managers/ExportManager';
import BookmarkManager from './src/managers/BookmarkManager';
import AnalyticsManager from './src/managers/AnalyticsManager';
import FileManager from './src/managers/FileManager';
import CacheManager from './src/managers/CacheManager';
import PDFCompressor, { CompressionPreset, CompressionLevel } from './src/PDFCompressor';

// Alias for backward compatibility and intuitive naming
export const PDFCache = CacheManager;

export {
    ExportManager,
    BookmarkManager,
    AnalyticsManager,
    FileManager,
    CacheManager,
    PDFCompressor,
    CompressionPreset,
    CompressionLevel
};

// ========================================
// Programmatic search and JSI API (fix #24)
// ========================================
export { searchTextDirect, PDFJSI };

// ========================================
// TIER 3: Pre-built UI Components
// ========================================

import Toolbar from './src/components/Toolbar';
import BookmarkModal from './src/components/BookmarkModal';
import BookmarkListModal from './src/components/BookmarkListModal';
import BookmarkIndicator from './src/components/BookmarkIndicator';
import ExportMenu from './src/components/ExportMenu';
import OperationsMenu from './src/components/OperationsMenu';
import AnalyticsPanel from './src/components/AnalyticsPanel';
import Toast from './src/components/Toast';
import LoadingOverlay from './src/components/LoadingOverlay';
import BottomSheet from './src/components/BottomSheet';
import SidePanel from './src/components/SidePanel';

export {
    Toolbar,
    BookmarkModal,
    BookmarkListModal,
    BookmarkIndicator,
    ExportMenu,
    OperationsMenu,
    AnalyticsPanel,
    Toast,
    LoadingOverlay,
    BottomSheet,
    SidePanel
};

// ========================================
// TIER 4: Utility Modules
// ========================================

import ErrorHandler from './src/utils/ErrorHandler';
import TestData from './src/utils/TestData';

export {
    ErrorHandler,
    TestData
};
