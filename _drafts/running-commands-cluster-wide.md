---
layout: post
title: Running commands cluster-wide without any management tool
author: Alain Rodriguez
category: blog
tags: cassandra, operation, ssh
---

Managing Cassandra is actually often managing multiple nodes the exact same way.

As Cassandra is a peer to peer system where all the nodes are equals, there is no master or slaves. This Cassandra property allows us to easily manage any cluster by simply running the same command on all the nodes to have a change applied cluster-wide.

Yet, managing multiple nodes efficiently requires the operator to have a good set of tools. Spending some time to write scripts to automate the action the operator is about to repeat on each node often spare some time, removes frustration and is less error prone. Being able to operate from one node to affect all the nodes in the cluster or datacenter is also very handy. That's why some management tools like [Chef](https://www.chef.io/chef/), [Ansible](https://www.ansible.com/), [Salt](http://saltstack.com/) and many more are used to manage Cassandra clusters.

In the past I faced some cases where no such tool was available, for distinct reason, like clusters being too small and where it was not worth it installing and configuring a management tool or while doing consulting and not having the management tool configured for my user. I imagine there are a lot of people managing Cassandra clusters without such a tool.

So I will expose solutions I ended up using here, to make them available to anyone in the same situation.

# Small number of nodes / Using an interface

I have used [csshx](https://github.com/brockgr/csshx) for a long time. I was managing from 3 to 40 nodes clusters by then. Basically csshx allows you to connect to multiple servers in distinct consoles easily and then to type in multiple console simultaneously.

csshX is for Mac OS X, but the tool exists for linux as well, it is called [cssh](http://linux.die.net/man/1/cssh).

## Configure and run cssxh

To make using csshx easier, it is possible to save 'clusters' (actually custom lists of servers) by adding or modifying the configuration file `/etc/clusters`. This file uses the format described in the [documentation](http://linux.die.net/man/1/cssh):

    <tag> [user@]<server> [user@]<server> [...]

Example:

    Alains-MacBook-Pro:~ alain$ cat /etc/clusters
    test 127.0.0.1 alain@127.0.0.2 127.0.0.3:22 alain@127.0.0.4:22

Then opening all the terminals, for the test cluster, is as easy as running:

    csshx test

Here is a standard view of using csshx

![Opening remote consoles](/images/running-commands-cluster-wide/csshx-presentation.png)

In this picture, the consoles #1 to #4 are the remote connections opened, the #5 is the 'master' console and the #6 is the original console where I ran the csshx command from.

Running any command from the 'master' console (#6) will send it at the same time to all the 'slave' consoles (#1 to #4)

It is possible to use only a 'slave' console by selecting it window. Remember to click back on the 'master' console to start sending to all the 'slave' consoles again.

Some options are available, to display console on multiple screen and some other nice features. Use the man option to see all the available options:

    csshx -m
    csshx -h

## Strengths and  Limits

Having the servers physically displayed, having an open terminal in every node is great since it allows a visual control on everything, you can easily monitor all the nodes, then focus on the bad once just with a click, which is awesome.

csshx also allows to edit configuration files from every node at the same time and then edit them all together or separately. It is also possible to past a config which is nice and removes a lot of repetitive and error prone manual work.

![Opening remote consoles](/images/running-commands-cluster-wide/csshx-edit-config.png)

Yet, as every node is displayed depending on the screen size, the number of screen and the number of nodes, csshx can quickly become quite tricky to use and far less efficient.

# Bigger number of nodes / Running scripts

As you might imagine, when the csshx console are too small it becomes very hard to use. If for some reason no automation or management tool (such as [Chef](https://www.chef.io/chef/), [Ansible](https://www.ansible.com/), [Salt](http://saltstack.com/)) is set up, then the following tips might be of some use.

The main idea is that if we can't or don't want to manage all the servers using csshx, then we need to centralize all the outputs and run the commands from one node.

To make this easy to use to anyone I quickly scripted a one-liner I use when no better option is available, and
made it available on [github](https://github.com/arodrime/cassandra-tools/blob/master/rolling-ssh/rolling-cmd.sh).

See the [readme](https://github.com/arodrime/cassandra-tools/blob/master/rolling-ssh/README.md) file for more information on how to use it.

Those tools allowing to manage a list of servers is very powerful and efficient as it is possible to drop scripts on all the nodes and run them, allowing to perform complex operations as rolling upgrades in a fully automated way. Yet powerful tools are also often more risky. It is important to be careful as any error will be repeated the same way on all the servers sequentially. Make sure to write scripts that perform checks the same way you would have manually done. Also, keep an eye during the process, be ready to interrupt it if needed. A last advice to mitigate the risks is to go one rack at the time by selecting nodes from one rack in the script, if using enough racks or Availability Zones.

# Example: Safe rolling restart
