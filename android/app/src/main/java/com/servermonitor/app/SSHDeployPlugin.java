package com.servermonitor.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Properties;

@CapacitorPlugin(name = "SSHDeploy")
public class SSHDeployPlugin extends Plugin {

    @PluginMethod
    public void deploy(PluginCall call) {
        String host = call.getString("host", "");
        int sshPort = call.getInt("sshPort", 22);
        String sshUser = call.getString("sshUser", "root");
        String sshPassword = call.getString("sshPassword", "");
        String smToken = call.getString("smToken", "");
        int smPort = call.getInt("smPort", 9090);

        if (host.isEmpty() || smToken.isEmpty()) {
            call.reject("host and smToken are required");
            return;
        }

        // Keep call alive for streaming
        call.setKeepAlive(true);

        new Thread(() -> {
            Session session = null;
            try {
                sendLog(call, "正在连接 SSH ...");

                JSch jsch = new JSch();
                session = jsch.getSession(sshUser, host, sshPort);
                session.setPassword(sshPassword);

                // Skip host key verification (trusted local network)
                Properties config = new Properties();
                config.put("StrictHostKeyChecking", "no");
                session.setConfig(config);
                session.setTimeout(15000);
                session.connect();

                sendLog(call, "SSH 连接成功");

                // Build the remote install command
                // Uses the install.sh script in remote download mode (curl from GitHub)
                String escapedToken = smToken.replace("'", "'\\''");
                String cmd = String.format(
                    "curl -sSL https://raw.githubusercontent.com/zhx8702/server-monitor/main/agent/scripts/install.sh | SM_TOKEN='%s' SM_PORT=%d bash 2>&1",
                    escapedToken, smPort
                );

                sendLog(call, "执行安装脚本 ...");

                ChannelExec channel = (ChannelExec) session.openChannel("exec");
                channel.setCommand(cmd);
                channel.setErrStream(null); // merged in 2>&1

                InputStream in = channel.getInputStream();
                channel.connect();

                BufferedReader reader = new BufferedReader(new InputStreamReader(in, "UTF-8"));
                String line;
                String existingToken = "";
                String existingPort = "";

                while ((line = reader.readLine()) != null) {
                    if (line.startsWith("SM_EXISTING_TOKEN=")) {
                        existingToken = line.substring("SM_EXISTING_TOKEN=".length());
                    } else if (line.startsWith("SM_EXISTING_PORT=")) {
                        existingPort = line.substring("SM_EXISTING_PORT=".length());
                    } else {
                        sendLog(call, line);
                    }
                }

                int exitCode = channel.getExitStatus();
                channel.disconnect();
                session.disconnect();

                JSObject result = new JSObject();
                if (exitCode == 0) {
                    result.put("success", true);
                    result.put("message", existingToken.isEmpty() ? "部署完成" : "已是最新版本，跳过安装");
                    if (!existingToken.isEmpty()) {
                        result.put("existingToken", existingToken);
                        result.put("existingPort", existingPort.isEmpty() ? smPort : Integer.parseInt(existingPort));
                    }
                } else {
                    result.put("success", false);
                    result.put("message", "脚本退出码: " + exitCode);
                }
                call.resolve(result);

            } catch (Exception e) {
                if (session != null && session.isConnected()) {
                    session.disconnect();
                }
                String msg = e.getMessage() != null ? e.getMessage() : "SSH 连接失败";
                sendLog(call, "错误: " + msg);

                JSObject result = new JSObject();
                result.put("success", false);
                result.put("message", msg);
                call.resolve(result);
            }
        }).start();
    }

    private void sendLog(PluginCall call, String message) {
        JSObject data = new JSObject();
        data.put("log", message);
        notifyListeners("deployLog", data);
    }
}
