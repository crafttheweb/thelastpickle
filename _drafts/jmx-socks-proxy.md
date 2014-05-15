---
layout: post
title: JMX Management over SOCKS Proxy
author: Patricia Gorla
category: blog
tags: cassandra, monitoring, ssh, jmx
---

Large-scale applications require way to examine at the internals while running. John comes with Java management extensions, a set of tools to monitor and adjust system objects.

The represented by a managed being objects (MBean) implemented in the application.

Cassandra uses JMX extensively: tools such as nodetool and OpsCenter monitor cluster health through MBeans.

### JMX

// inter arrival times?

Objects in the code implement an MBean interface, providing JMX access to the exposed methods. The `FailureDetectorMBean` exposes read access to endpoint state, endpoint count, inter arrival times, and read/write access to the phi convict threshold (a measure of health for the node).

FailureDetectorMBean.java
```java
package org.apache.cassandra.gms;

import java.net.UnknownHostException;
import java.util.Map;

public interface FailureDetectorMBean
{
    public void dumpInterArrivalTimes();

    public void setPhiConvictThreshold(double phi);

    public double getPhiConvictThreshold();

    public String getAllEndpointStates();

    public String getEndpointState(String address) throws UnknownHostException;

    public Map<String, String> getSimpleStates();

    public int getDownEndpointCount();

    public int getUpEndpointCount();
}

```

### Connecting via JConsole

Individual notes can be accessed and manipulated via JMX tools such as JConsole and jmxterm.

Connecting to the local notice simple. Start JConsole on your machine, and make sure port 7199 is accessible.

The screen will automatically populate with a list of all running Java programs.

Select Cassandra, and then click 'MBeans > o.a.c.net > FailureDetector'. This exposes the FailureDetector object, which implements the FailureDetectorMbean object.

[figure]

Note: you may get an insecure SSL error; click continue.

You can now adjust any of the settings exposed in JMX.

[figure]

But production clusters are placed behind firewalls for good reason, preventing any outside network connection to the database.


### Connecting via SSH SOCKS PROXY

Fortunately, we can set up a [SOCKS proxy connection](http://en.wikipedia.org/wiki/SOCKS) using SSH.

The SOCKS proxy transmits TCP connections through the proxy server. This means that any request -- HTTP or otherwise -- is viewed as originating from the proxy server. It's an effective way of bypassing the firewalls in place on a computer, as well as masking the origin of a request.

SSH options:
```
-D [bind_address:]port
             Specifies a local ``dynamic'' application-level port forwarding.  This works by allocating a socket to listen to port on the local side, optionally bound to the specified bind_address.  Whenever a connection is made to this port, the connection is forwarded over the secure channel, and the application
             protocol is then used to determine where to connect to from the remote machine.
			 
-N           Do not execute a remote command.  This is useful for just forwarding ports (protocol version 2 only).
```

Setting up the proxy server is simple with using the `-D` flag and a unique port. Add `-v` for verbosity, and `-N` to set up an interruptable connection to the server.

```
ssh -vND <port> remote_server
```

```
$ ssh -vND 9999 vpn
OpenSSH_6.2p2, OSSLShim 0.9.8r 8 Dec 2011
...
debug1: Entering interactive session.
```

Next, open up 'System Preferences > Network > Advanced > Proxies', and enable the SOCKS proxy on localhost:9999.

[figure]

Now you are connected to the remote server. Make sure to turn off any other applications that use a network; that traffic will be routed through the proxy.

* Connecting to JConsole remotely

Now you can connect to any remote process as if it were on your machine.

Start jconsole and add 'localhost:7199' as a remote entry.

[figure]

You're now connected to Cassandra, and can change the values while the process is running. Make sure to monitor the logs for any anomalies while updating the configuration.
