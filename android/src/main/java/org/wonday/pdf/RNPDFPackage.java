package org.wonday.pdf;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

public class RNPDFPackage implements ReactPackage {

    static {
        // JNI_OnLoad in libNitroPdfJsi registers PdfLibrary/PdfDocument with Nitro,
        // so it must be loaded before JS calls createHybridObject.
        System.loadLibrary("NitroPdfJsi");
    }

    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Arrays.asList(new PdfViewManager(), new PdfPageViewManager());
    }
}
