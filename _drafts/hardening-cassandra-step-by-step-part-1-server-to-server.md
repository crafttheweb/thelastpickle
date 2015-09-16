---
layout: post
title: Hardening Cassandra Step by Step - Part 1: Server to Server (And a Gentle Intro to Certificates)
author: Nate McCall
category: blog
tags: cassandra, security, configuration, SSL, encryption
---

## Overview
For this first post, we are going to walk through the steps to *correctly* create SSL certificates. With that under our belt we can use them to enable server to server encryption on a local CCM cluster. Being further down the stack, most developers are not exposed to encryption in their day to day work. Hopefully this post will give you enough information to make the correct choices.

The current documentation (http://docs.datastax.com/en/cassandra/2.1/cassandra/security/secureSSLCertificates_t.html) describes a  basic approach that is useful for development and experimentation. However, were these steps used in building a production deployment, they would create a substantial maintenance burden and be quite difficult to automate. These concerns would be amplified by the need to scale out.  Most importantly, if followed directly, you will have secured traffic, but have done nothing to thwart any bad actor with network access from attacking your cluster directly.

Why is this? Because like most examples of generating certificates and configuring SSL, the documentation still holds to the model of a client, like a web browser, talking to a server. In this model, the main concern is that the client is validating the identity of the web server and that the data is secured in transit. The client simply sends a public key to the server identifying itself so they can negotiate a secured connection. The server has no trust relationship with that client, it's just using the certificate to encrypt the communication.

Grafting this onto our cluster model, it means that a Cassandra node will open secure sockets with other nodes, but not attempt to identify the actor requesting the connection. Think about that for a second. Without authenticating that we are indeed talking to another Cassandra node, we can write a program to attach to a cluster and execute arbitrary commands, listen to writes on arbitrary token ranges, even inject an administrator account into the system_auth table with specially crafted message packets. In short, we can do pretty much anything. The best part: the communication between our program and the cluster will be via SSL, so no one can tell it's happening.

Instead, the model we want to follow is called Client Certificate Authentication. Using this approach, the server takes the extra step of verifying the client against a local trust store. If it does not know about the client's certificate either directly or through a chain of trust, it will not accept the connection. The extra verification can be enabled with a simple flag in Cassandra’s configuration : `require_client_auth: true`.

Setting this option (as we’ll see in the steps below) enables client certificate authentication as previously discussed. For encrypting inter-node traffic for our cluster, it means that every node has a trust relationship with each other which can be verified against a local Trust Store. We are going to walk through all the steps necessary to set up inter node encryption in a way that will make it both easy to manage and production deployable.

## Creating a Three Node Test Cluster
We'll start by using `ccm` to create a three node cluster which we'll use to walk through SSL setup. If you are not familiar with `ccm`, you can find information and installation instructions here: https://github.com/pcmanus/ccm

Provided you have `ccm` setup and configured correctly, the following commands will create and start an Apache Cassandra cluster named `sslverify` `2.1.9`:

```
ccm create -n 3 -v 2.1.9 sslverify
ccm start
```
Each of the three nodes in our cluster will have all their specific configuration and data placed in sub directories of `~/.ccm/sslverify/` following the convention of a normal Cassandra distribution.

You can verify the cluster's status from both the `ccm` and Cassandra perspectives with:
```
ccm status
ccm node1 nodetool status
```

With our cluster in place, it's time to move on to certificate management.

### BYO Certificate Authority
When dealing with even a small cluster, creating our own Certificate Authority (CA) becomes essential to minimizing trust chain complexity. This allows us to create a Root Certificate that can be used to sign all of our server-specific certificates. Once signed, this creates a trust chain that will make managing the certificates significantly easier. We'll go into further detail on this below.

For the first step, create the Certificate Authority (CA) using the following configuration file titled `gen_ca_cert.conf` in the current directory:
```
[ req ]
distinguished_name     = req_distinguished_name
prompt                 = no
output_password        = mypass
default_bits           = 2048

[ req_distinguished_name ]
C                      = US
ST                     = TX
L                      = Austin
O                      = TLP
OU                     = TestCluster
CN                     = TestClusterMasterCA
emailAddress           = info@thelastpickl.com
```
Obviously, you'll want to put your specific information in there. When I create a CA for Cassandra, I like to use the the name of the cluster for the Organizational Unit (OU) and specify that it is our cluster CA via the Common Name (CN) attribute. This is of course a matter of personal preference. The take away is to pick something that will make managing these easy.

Now, run the following OpenSSL command to create the CA:
```
openssl req -config gen_ca_cert.conf -new -x509 -keyout ca-key -out ca-cert -days 365
```
There is a lot going on here, so let's break that one down:
- `req`: An OpenSSL sub-command saying that we are (in this case) creating a PKCS#10 X.509 Certificate (see https://www.openssl.org/docs/manmaster/apps/req.html for full details). Note: the following parameters are all options of this command
- `-config`: The path to the config file above to avoid having to provide information on STDIN
- `-new`: This is a new signing request we are making
- `-x509`: The output will be a self-signed certificate we can use as a root CA
- `-keyout`: The filename to which we will write our key
- `-out`: The filename to which we will write our certificate
- `-days`: The number of days for which the generated certificate will be valid

You can verify the contents of the certificate you just created with the following command:
```
openssl x509 -in ca-cert -text -noout
```

### Per-Server Certificate Createion
Now we will create a public/private key pair for each server. In the process of doing this step, we are creating the server-specific key stores which will be distributed directly to the servers. We've used the node names from the CCM cluster we created as part of our naming scheme to ease management:

```
keytool -genkeypair -keyalg RSA -alias node1 -keystore node1-server-keystore.jks -storepass awesomekeypass -keypass awesomekeypass -validity 365 -keysize 2048 -dname "CN=node1, OU=SSL-verification-cluster, O=TheLastPickle, C=US"
keytool -genkeypair -keyalg RSA -alias node2 -keystore node2-server-keystore.jks -storepass awesomekeypass -keypass awesomekeypass -validity 365 -keysize 2048 -dname "CN=node2, OU=SSL-verification-cluster, O=TheLastPickle, C=US"
keytool -genkeypair -keyalg RSA -alias node3 -keystore node3-server-keystore.jks -storepass awesomekeypass -keypass awesomekeypass -validity 365 -keysize 2048 -dname "CN=node3, OU=SSL-verification-cluster, O=TheLastPickle, C=US"
```
As with the OpenSSL incantation above, let's summarize what we are doing for each node:
- `-genkeypair`: the keytool command to generate a public/private key pair combination
- `-keyalg`: The algorithm to use, RSA in this case
- `-alias`: An alias to use for this public/private key pair. It needs to identify the public key when imported into a key store. I usually use some form of $hostname-cassandra
- `-keystore`: The location of our key store (created if it does not already exist)
- `-storepass`: The password for the key store
- `-keypass`: The password for the key
- `-validity`: The number of days for which this key pair will be valid
- `-keysize`: The size of the key to generate
- `-dname`: See below

The arguments to `-dname` can be summarized as follows: the subject's common name (CN), organizational unit (OU), organization (O), and country (C). In this context, it's a good idea to make the CN the hostname. For OU, I like to use the same string as the `cluster_name` attribute in `cassandra.yaml` as a personal preference. The other attributes are straight forward, but can be whatever given this is all self-signed. Just be consistent with them.

As with the CA we created earlier on, we should verify that the key store is accessible and contains the key pair with the correct information:
```
keytool -list -v -keystore node1-server-keystore.jks -storepass awesomekeypass
```

Note: `-genkeypair` can also take a `-startdate` option which is handy when you know you are making a configuration change at some point in the future. If used, the `-validity` is then calculated as from that point onwards.

Note: There is currently a limitation in Cassandra which forces us to use the same password for the key store as for the key. In all fairness, `javax.security` is a very obtuse API with which to work. Specifically, loading individual certificates with different passwords from a key store is shockingly cumbersome, particularly if one or more of those entries is based on a trust chain.


### export certs for signing
With our key stores created and populated, we now need to export a certificates from each node's key store as a signing request for our CA:
```
keytool -keystore node1-server-keystore.jks -alias node1 -certreq -file node1_cert_sr -keypass awesomekeypass -storepass awesomekeypass
keytool -keystore node2-server-keystore.jks -alias node2 -certreq -file node2_cert_sr -keypass awesomekeypass -storepass awesomekeypass
keytool -keystore node3-server-keystore.jks -alias node3 -certreq -file node3_cert_sr -keypass awesomekeypass -storepass awesomekeypass
```
We've seen some new `keytool` options here:
- `-certreq`
- `-file`

### sign each cert with the CA root
With the certificate signing requests ready to go, it's now time to sign each with our CA via OpenSSL:
```
openssl x509 -req -CA ca-cert -CAkey ca-key -in node1_cert_sr -out node1_cert_signed -days 365 -CAcreateserial -passin pass:mypass
openssl x509 -req -CA ca-cert -CAkey ca-key -in node2_cert_sr -out node2_cert_signed -days 365 -CAcreateserial -passin pass:mypass
openssl x509 -req -CA ca-cert -CAkey ca-key -in node3_cert_sr -out node3_cert_signed -days 365 -CAcreateserial -passin pass:mypass
```
This OpenSSL incantation is quite a bit different than our the one for creating a CA above, so we'll again summarize:
- `x509` Use the display and signing subcommand (https://www.openssl.org/docs/manmaster/apps/x509.html)
- `-req` We are signing a certificate request as opposed to a certificate
- `-CA` The CA cert file created above
- `-CAKey` The CA key file created above
- `-in` The certificate request we are signing
- `-out` The newly-signed certificate file to create
- `-days` The number of days for which the signed certificate will be valid
- `-CAcreateserial` Create a serialnumber for this CSR
- `-passin` The keypassword source. The arguments to passin have their own formatting instructions. See 'Pass Phrase Arguments' on this page: https://www.openssl.org/docs/manmaster/apps/openssl.html

## Add the CA to the Key Store
With the certificates now signed, we will need to re-import them back into each node's key store via the `-import` sub-command of `keytool`. However, before we can do that, we have to add the certificate from our CA to each key store. This step is required for the trust chain to function correctly.
```
keytool -keystore node1-server-keystore.jks -alias CARoot -import -file ca-cert -noprompt -keypass awesomekeypass -storepass awesomekeypass
keytool -keystore node2-server-keystore.jks -alias CARoot -import -file ca-cert -noprompt -keypass awesomekeypass -storepass awesomekeypass
keytool -keystore node3-server-keystore.jks -alias CARoot -import -file ca-cert -noprompt -keypass awesomekeypass -storepass awesomekeypass
```

With each key store now containing our CA, we can import the signed certificate with the same alias back into the key store:
```
keytool -keystore node1-server-keystore.jks -alias node1 -import -file node1_cert_signed -keypass awesomekeypass -storepass awesomekeypass
keytool -keystore node2-server-keystore.jks -alias node2 -import -file node2_cert_signed -keypass awesomekeypass -storepass awesomekeypass
keytool -keystore node3-server-keystore.jks -alias node3 -import -file node3_cert_signed -keypass awesomekeypass -storepass awesomekeypass
```

### Building the Trust Store
Our key store is now all set. But since we are using Client Certificate Authentication, we need to add a trust store to each node. We do this by creating the trust store with the CA root certificate. This can be done with the following command:
```
keytool -keystore generic-server-truststore.jks -alias CARoot -importcert -file ca-cert -keypass mypass -storepass truststorepass -noprompt
```
Now this is where it all comes together. Since all of our instance-specific keys have now been signed by the CA, we can share this trust store instance across the cluster as it effectively just says "I'm going to trust all connections whose client certificates were signed by this CA." This is the same way that an authority like Verisign works when you get a commercial certificate for your web server. We are in this case just acting as our own authority (which is the safest approach when creating public key infrastructure for your internal services).

## Configuring the Cluster
So now that we have all of our files created, let's place them where they go so CCM can find them. First, we'll move the key stores:
```
cp node1-server-keystore.jks ~/.ccm/sslverify/node1/conf/server-keystore.jks
cp node2-server-keystore.jks ~/.ccm/sslverify/node2/conf/server-keystore.jks
cp node3-server-keystore.jks ~/.ccm/sslverify/node3/conf/server-keystore.jks
```
Note: we make the target name here generic for the sake of convention as this is what you would do with a CM system anyway.

And the same with generic trust store:
```
cp generic-server-truststore.jks ~/.ccm/sslverify/node1/conf/server-truststore.jks
cp generic-server-truststore.jks ~/.ccm/sslverify/node2/conf/server-truststore.jks
cp generic-server-truststore.jks ~/.ccm/sslverify/node3/conf/server-truststore.jks
```

### Add Encryption Options to the Configuration:
With the files in place, let's modify the configuration to enable server to server encryption. Replace the `server_encryption_options` in each server's `cassandra.yaml` located in `~/.ccm/sslverify/[server]/conf/` with the following (adjusting both the path to fit your environment and the "server" placeholder below for each of our three nodes):
```
server_encryption_options:
  internode_encryption: all
  keystore: /Users/zznate/.ccm/sslverify/[server]/conf/server-keystore.jks
  keystore_password: awesomekeypass
  truststore: /Users/zznate/.ccm/sslverify/[server]/conf/server-truststore.jks
  truststore_password: truststorepass
  require_client_auth: true
```

Before restarting, we should install the strong encryption policy files. Follow the download titled "Java Cryptography Extension (JCE) Unlimited Strength Jurisdiction Policy Files for JDK/JRE 8" here:
http://www.oracle.com/technetwork/java/javase/downloads/index.html

Those files usually get installed into `${java.home}/jre/lib/security/`. The internet has copious amounts of information for specific systems.

Some additional info on why you need to do this can be found here:
http://docs.oracle.com/javase/8/docs/technotes/guides/security/SunProviders.html#importlimits

With the policy jars in place, let's restart `node1` via ccm:
```
ccm node1 stop
ccm node1 start
```

If everything is working correctly, you should see log output (available in ~/.ccm/sslverify/[server]/logs/system.log) containing:
```
Starting Encrypted Messaging Service on SSL port 7001
```

The output of `ccm node1 nodetool status` should look like:
```
Datacenter: datacenter1
=======================
Status=Up/Down
|/ State=Normal/Leaving/Joining/Moving
--  Address    Load       Tokens  Owns   Host ID                               Rack
UN  127.0.0.1  15.78 MB   1       33.3%  7ac70e8c-507b-4dfc-bed8-ddbd736ae9dc  rack1
DN  127.0.0.2  ?          1       33.3%  e12e1ac3-12b8-48e8-8f5e-897573026896  rack1
DN  127.0.0.3  ?          1       33.3%  0e867789-ec7d-4704-b0ed-e0437a28f83d  rack1
```
What we are seeing here is that `node1` has toggled over to using SSL and can no longer communicate with the other two cluster members. It therefore assumes they are down. Executing `nodetool status` against one of the other nodes will indeed show the opposite picture.


Let's move on with the rest of the cluster. Repeating the process above with `node2`, the output from `ccm node1 nodetool status` should now show:
```
Datacenter: datacenter1
=======================
Status=Up/Down
|/ State=Normal/Leaving/Joining/Moving
--  Address    Load       Tokens  Owns   Host ID                               Rack
UN  127.0.0.1  15.79 MB   1       33.3%  7ac70e8c-507b-4dfc-bed8-ddbd736ae9dc  rack1
UN  127.0.0.2  37.87 MB   1       33.3%  e12e1ac3-12b8-48e8-8f5e-897573026896  rack1
DN  127.0.0.3  ?          1       33.3%  0e867789-ec7d-4704-b0ed-e0437a28f83d  rack1
```

And the same again with `node3` should show all nodes as up.
