/**
 * Copyright (c) 2017-present, Wonday (@wonday.org)
 * All rights reserved.
 *
 * This source code is licensed under the MIT-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';
import React, {Component} from 'react';
import {FlatList} from 'react-native';

/**
 * FlatList wrapper that exposes scrollToXY used by PdfView.
 *
 * Do not `extends FlatList`: under RN 0.8x / Metro interop, the FlatList export
 * is often a plain object (or non-constructable), which throws
 * "Object is not a constructor" while evaluating this module.
 */
export default class PdfViewFlatList extends Component {
    _listRef = null;

    scrollToXY = (x, y) => {
        const list = this._listRef;
        if (!list) {
            return;
        }
        const scrollRef =
            list._listRef?._scrollRef ??
            (typeof list.getScrollResponder === 'function'
                ? list.getScrollResponder()
                : null);
        if (scrollRef && typeof scrollRef.scrollTo === 'function') {
            scrollRef.scrollTo({x, y, animated: false});
        }
    };

    scrollToIndex = (params) => {
        this._listRef?.scrollToIndex?.(params);
    };

    scrollToOffset = (params) => {
        this._listRef?.scrollToOffset?.(params);
    };

    render() {
        return (
            <FlatList
                {...this.props}
                ref={(ref) => {
                    this._listRef = ref;
                }}
            />
        );
    }
}
