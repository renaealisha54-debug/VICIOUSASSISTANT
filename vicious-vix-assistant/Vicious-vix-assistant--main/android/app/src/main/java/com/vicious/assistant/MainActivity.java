package com.vicious.assistant;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VixAccessibilityPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
