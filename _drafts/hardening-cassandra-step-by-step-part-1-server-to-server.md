---
layout: post
title: Hardening Cassandra Step by Step - Part 1 Inter-Node Encryption (And a Gentle Intro to Certificates)
author: Nate McCall
category: blog
tags: cassandra, security, configuration, SSL, encryption
---

## TL;DR:
This is a tutorial extracted from part of a presentation I gave at Cassandra Summit 2015 titled [Hardening Cassandra for Compliance (or Paranoia)](http://cassandrasummit-datastax.com/agenda/hardening-apache-cassandra-for-compliance-or-paranoia/). The [slides](http://www.slideshare.net/zznate/hardening-cassandra-for-compliance-or-paranoia) are available and the "SSL Certificates: a brief interlude" section is probably the most expedient route if you are impatient. We build on that process here by actually installing everything on a local three node cluster. I'll provide a link to the video of the presentation as soon as it is posted. 

## Overview
This is the first of a five part tutorial covering the following aspects of securing Apache Cassandra (including some handy features of DataStax Enterprise where relevant). As with the presentation mentioned above, we will break this down into the following:

- **Inter-node Communication**
- Encryption at Rest
- Client-Server Communication
- Authentication and Authorization
- Management and Tooling

Being further down the stack, most developers are not exposed to encryption in their day to day work. Therefre For this first post, we are focusing on Inter-node encryption. It is going to be a bit longer than the others as this post walks through the steps to *correctly* create SSL certificates. We'll put that knowledge to immediate use by configuring inter-node encryption on a local CCM cluster. Hopefully this tutorial will give you enough information to make the correct choices.

The [current documentation](http://docs.datastax.com/en/cassandra/2.1/cassandra/security/secureSSLCertificates_t.html) describes a  basic approach that is useful for development and experimentation. However, were these steps used in building a production deployment, they would create a substantial maintenance burden and be quite difficult to automate. These concerns would be amplified by the need to scale out.  Most importantly, if followed directly, you will have secured traffic, but have done nothing to thwart a bad actor with network access from attacking your cluster directly.

Why is this? Because like most examples of generating certificates and configuring SSL, the documentation still holds to the model of a client, like a web browser, talking to a server. In this model, the main concern is that the client is validating the identity of the web server and that the data is secured in transit. The client simply sends a public key to the server identifying itself so they can negotiate a secured connection. The server has no trust relationship with that client, it's just using the certificate to encrypt the communication.

Grafting this onto our cluster model, it means that a Cassandra node will open secure sockets with other nodes, but not attempt to identify the actor requesting the connection. Think about that for a second. Without authenticating that we are indeed talking to another Cassandra node, we can write a program to attach to a cluster and execute arbitrary commands, listen to writes on arbitrary token ranges, even inject an administrator account into the `system_auth` table with specially crafted message packets. In short, we can do pretty much anything. The best part: the communication between our program and the cluster will be via SSL, so no one will know it's happening.

Instead, the model we want to follow is called Client Certificate Authentication. Using this approach, the server takes the extra step of verifying the client against a local trust store (see [this page](http://javarevisited.blogspot.com/2012/09/difference-between-truststore-vs-keyStore-Java-SSL.html) for an excellent description of both trust stores and key stores in the context of the JDK). If it does not recognize the client's certificate either directly or through a chain of trust, it will not accept the connection. The extra verification can be enabled with a single flag in Cassandra’s configuration : `require_client_auth: true`.

Setting this option (as we’ll see in the steps below) enables Client Certificate Authentication as previously discussed. For encrypting inter-node traffic for our cluster, it means that each node has a trust relationship with the rest of the cluster which can be verified against a local Trust Store.

To demonstrate how to create and install all the components for this, we are going to walk through all the steps necessary to set up inter node encryption in a way that will make it both easy to manage and production deployable.

## Creating a Three Node Test Cluster
We'll start by using `ccm` to create a three node cluster which we'll use to walk through SSL setup. If you are not familiar with `ccm`, you can find information and installation instructions [here](https://github.com/pcmanus/ccm).

Provided you have `ccm` setup and configured correctly, the following commands will create and start an Apache Cassandra cluster named `sslverify` using Apache Cassandra version `2.1.9`:

```
ccm create -n 3 -v 2.1.9 sslverify
ccm start
```
Configuration and data for each of the three nodes in the cluster will be placed in sub directories under `~/.ccm/sslverify/` following the convention of a normal Cassandra distribution from there on.

You can verify the cluster's status from both the `ccm` and Cassandra perspectives with:
```
ccm status
ccm node1 nodetool status
```

Note: to use a Cassandra command directly, move into the directory for a node and execute the command as you would on any local installation. For example, the following commands would have the same effect as the `ccm` wrapped version above:
```
cd ~/.ccm/sslverify/node1
./bin/nodetool status
```

With our cluster in place, it's time to move on to certificate management.

### BYO Certificate Authority
When dealing with even a small cluster, creating our own Certificate Authority (CA) becomes essential to minimizing trust chain complexity. This allows us to create a Root Certificate that can be used to sign all of our server-specific certificates. Once signed, this creates a trust chain that will make managing the certificates significantly easier. We'll go into further detail on this below.

We will be using OpenSSL for create the Certificate Authority (CA) and sign certificate requests with such. The `openssl` tool should be available on most UNIX-derived systems. For this tutorial, I was using `OpenSSL 1.0.1j 15 Oct 2014` on OS X `10.10.5`.

For the first step, create the CA using the following configuration file titled `gen_ca_cert.conf` in the current directory:
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
emailAddress           = info@thelastpickle.com
```
Obviously, you'll want to put your specific information in there. When I create a CA for Cassandra, I like to use the the name of the cluster for the Organizational Unit (OU) and specify that it is our cluster CA via the Common Name (CN) attribute. This is of course a matter of personal preference. The take away is to pick something that will make managing these easy.

Now, run the following OpenSSL command to create the CA:
```
openssl req -config gen_ca_cert.conf -new -x509 -keyout ca-key -out ca-cert -days 365
```
There is a lot going on here, so let's break that one down:
- `req`: An OpenSSL sub-command saying that we are (in this case) creating a [PKCS#10 X.509 Certificate](https://www.openssl.org/docs/manmaster/apps/req.html). Note: the following parameters are all options of the `req` command
- `-config`: The path to the config file above to avoid having to provide information on STDIN
- `-new`: This is a new signing request we are making
- `-x509`: The output will be an [X.509](https://en.wikipedia.org/wiki/X.509) compatible self-signed certificate we can use as a root CA
- `-keyout`: The filename to which we will write our key
- `-out`: The filename to which we will write our certificate
- `-days`: The number of days for which the generated certificate will be valid

You can verify the contents of the certificate you just created with the following command:
```
openssl x509 -in ca-cert -text -noout
```


### Per-Server Certificate Creation
Now we will create a public/private key pair for each server using the built-in [keytool utility](https://docs.oracle.com/javase/8/docs/technotes/tools/unix/keytool.html) (*note*: I used JDK 8 for this tutorial, in which `keytool` has had a bit of a revamp - see the previous link for details).

In the process of doing this step, we are creating the node-specific key stores which will be distributed directly to those nodes in a later step. We've used the node names from the `ccm` cluster we created previously as part of our naming scheme:

```
keytool -genkeypair -keyalg RSA -alias node1 -keystore node1-server-keystore.jks -storepass awesomekeypass -keypass awesomekeypass -validity 365 -keysize 2048 -dname "CN=node1, OU=SSL-verification-cluster, O=TheLastPickle, C=US"
keytool -genkeypair -keyalg RSA -alias node2 -keystore node2-server-keystore.jks -storepass awesomekeypass -keypass awesomekeypass -validity 365 -keysize 2048 -dname "CN=node2, OU=SSL-verification-cluster, O=TheLastPickle, C=US"
keytool -genkeypair -keyalg RSA -alias node3 -keystore node3-server-keystore.jks -storepass awesomekeypass -keypass awesomekeypass -validity 365 -keysize 2048 -dname "CN=node3, OU=SSL-verification-cluster, O=TheLastPickle, C=US"
```
As with the OpenSSL incantation above, let's summarize what we are doing for each node:
- `-genkeypair`: the keytool command to generate a public/private key pair combination
- `-keyalg`: The algorithm to use, RSA in this case
- `-alias`: An alias to use for this public/private key pair, `alias` is used to identify the public key when imported into a key store. I usually use some form of $hostname-cassandra
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

#### Some Things to Note
The `-genkeypair` sub-command can also take a `-startdate` option which is handy when you know you are making a configuration change at some point in the future. If used, the `-validity` is then calculated as being from that point in time onwards.

There is currently a limitation in Cassandra which forces us to use the same password for the key store as for the key. In all fairness, `javax.security` is a very obtuse API with which to work. Specifically, loading individual certificates with different passwords from a key store is shockingly cumbersome, particularly if one or more of those entries is based on a trust chain.

Using the `CN` attribute for the hostname is considered deprecated in the context of [PKI](https://en.wikipedia.org/wiki/Public_key_infrastructure). You can enable DNS hostname verification (referred to as "Subject Alternative Name" in PKI parlance), but since we building our own CA for private consumption, I consider it overkill for this case. Nevertheless, if you want to do this, simply append `-ext SAN=DNS:thelastpickle.com` to the `keytool` invocation above. You'll have to do the same when generating the CA as well (see the [OpenSSL documentation]((https://www.openssl.org/docs/manmaster/apps/req.html)) for details).


### Export Certificates as Signing Requests
With our key stores created and populated, we now need to export a certificates from each node's key store as a "Signing Request" for our CA:
```
keytool -keystore node1-server-keystore.jks -alias node1 -certreq -file node1_cert_sr -keypass awesomekeypass -storepass awesomekeypass
keytool -keystore node2-server-keystore.jks -alias node2 -certreq -file node2_cert_sr -keypass awesomekeypass -storepass awesomekeypass
keytool -keystore node3-server-keystore.jks -alias node3 -certreq -file node3_cert_sr -keypass awesomekeypass -storepass awesomekeypass
```
We've seen two new `keytool` options here which we'll briefly describe:
- `-certreq` another `keytool` sub-command, this says to export the certificate specifically for signing by a CA
- `-file` specifies the file to which the signing request will be written

### Sign Each Certificate with the CA's Public Key
With the certificate signing requests ready to go, it's now time to sign each with our CA's public key via OpenSSL:
```
openssl x509 -req -CA ca-cert -CAkey ca-key -in node1_cert_sr -out node1_cert_signed -days 365 -CAcreateserial -passin pass:mypass
openssl x509 -req -CA ca-cert -CAkey ca-key -in node2_cert_sr -out node2_cert_signed -days 365 -CAcreateserial -passin pass:mypass
openssl x509 -req -CA ca-cert -CAkey ca-key -in node3_cert_sr -out node3_cert_signed -days 365 -CAcreateserial -passin pass:mypass
```
This OpenSSL incantation is quite a bit different than our the one for creating a CA above, so we'll again summarize:
- `x509` Use the display and [signing subcommand](https://www.openssl.org/docs/manmaster/apps/x509.html)
- `-req` We are signing a certificate request as opposed to a certificate
- `-CA` The certificate file we specified via the `-out` parameter used when creating our CA
- `-CAKey` The key file we specified via the `-keyout` parameter used when creating our CA
- `-in` The per-node certificate request we are signing; this was the `-file` parameter from the Signing Request step above
- `-out` The newly-signed certificate file to create (use a clear naming scheme to keep track of files)
- `-days` The number of days for which the signed certificate will be valid
- `-CAcreateserial` Create a serialnumber for this CSR (see the doc `openssl x509` documentation above, it's complicated)
- `-passin` The keypassword source. The arguments to `passin` have their own [formatting instructions](https://www.openssl.org/docs/manmaster/apps/openssl.html) with which you should become familiar

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
Our key store is now all set. But since we are using Client Certificate Authentication, we need to add a trust store to each node. This is how each node will verify incoming connections from the rest of the cluster.

All we need to do is create trust store by importing CA root certificate's public key:
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
With the files in place, let's modify the configuration to enable server to server encryption. Replace the `server_encryption_options` in each server's `cassandra.yaml` located in `~/.ccm/sslverify/[server]/conf/` with the following (adjusting the path to fit your environment and the $NODE variable below for each of our three nodes):
```
server_encryption_options:
  internode_encryption: all
  keystore: /Users/zznate/.ccm/sslverify/$NODE/conf/server-keystore.jks
  keystore_password: awesomekeypass
  truststore: /Users/zznate/.ccm/sslverify/$NODE/conf/server-truststore.jks
  truststore_password: truststorepass
  protocol: TLS
  algorithm: SunX509
  store_type: JKS
  cipher_suites: [TLS_RSA_WITH_AES_256_CBC_SHA]
  require_client_auth: true
```

In the above snippet, we have specified (256bit AES)[https://en.wikipedia.org/wiki/Advanced_Encryption_Standard]. This is a fairly cypher and is therefore subject to US export control (I'm not providing a link here because this whole idea of cryptographic export controls is outmoded at best - look it up if you want </rant>). To use this, we need to install the strong encryption policy files into our JDK. Follow the download titled "Java Cryptography Extension (JCE) Unlimited Strength Jurisdiction Policy Files for JDK/JRE 8" from Oracle's [Java download page](http://www.oracle.com/technetwork/java/javase/downloads/index.html).

Those files usually get installed into `${java.home}/jre/lib/security/`. The internet has copious amounts of information for specific systems if that is not were your installation has placed them.

Some additional info on why you need to do this can be found here:
http://docs.oracle.com/javase/8/docs/technotes/guides/security/SunProviders.html#importlimits

You can skip the policy file installation by choosing a weaker strength cipher:
```
cipher_suites: [TLS_RSA_WITH_AES_128_CBC_SHA]
```

Depending on your requirements, your network segmentation, or any industry guidelines to which you may be beholden, using 128-bit keys might be fine. If you are going over any sort of public connection, you should do 256-bit keys.

With the policy jars in place (or with the 128-bit AES cipher specified), let's restart `node1` via ccm:
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

## One Last Thing
Whatever you have used for various expiration date parameters throughout this tutorial, make sure they sync it up with each other sensibly. Most importantly, put those dates on a calendar *now* with a healthy number of reminders leading up to expiration, inviting everyone even remotely involved with your team. I once saw an expired certificates cause havoc across an otherwise robust architecture because the dates were set and promptly forgotten about.

And just with any failure scenario, make sure you test your certificate updating process. This is not something you want to experiment with at the 11th hour.
