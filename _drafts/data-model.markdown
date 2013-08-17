---
layout: post
title: "Introduction to the Cassandra Data Model"
---

In the last year there have been a couple of different approaches to explaining the Cassandra data model. We've had the "multi dimensional hash" and "Column Family (CF) as table" ideas. Neither of which have felt like the right approach to me.

Both of these ideas feel like they are to some degree hiding the true nature of how Cassandra stores data. The multi-dimensional hash model hides the fact the key/column names are ordered and can contain just as much application knowledge as a column value. The Column Family as table idea suggests thats Column Families are some how prescriptive of the data they contain. It also downplays the (potentially) significant memory and processing overheads from using many Column Families. And both downplay the importance of a row.

TODO: data modelling needs to know about how the machine works. e.g. rdbms indexes

## Relational Baseline

Lets start with the normal Relational Database model we all know. The basic features we are interested in are:

  * DB Server: Software on one machine that hosts one or more databases.
  * Database: Contains data for one application. 
  * Table: Prescribes the columns that can be used to describe one entity in the application.
  * Column: 
  * Index: Defines a subset of the table columns that can be used to quickly select a row.
  * Row: One instance of an entity in the application. 

TODO: image 


## Cassandra Baseline

Now the basics of the Cassandra model:

 * Cluster: Software on many machines that hosts one or more Keyspaces.
 * Keyspace: Contains data for one application. 
 * Column Family: Container for columns contained in a row.
 * Column: 
 * Index:
 * Row: 
 

 
 
