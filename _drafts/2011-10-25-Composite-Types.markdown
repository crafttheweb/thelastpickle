---
layout: post
title: "Composite Types"
---

OUTLINE

- what happened before
- introduction, composite and dynamic types
- where can you use them ?
- Can you use them with counters ?
- the language
- examples

A common pattern in Cassandra is to combine multiple string values together in a compound or composite value for use as a row key for column name. For example, you may have a row key which stores an entity type and an entity id. Or when building a custom index a column name may hold the index value and the ID of the entity to handle duplicates. And if you squint a little you can also see the pattern in some common uses of Super Columns.

## Composite Values as Super Columns

A common argument for using a Super Column Family is that the extra level of hierarchy means the application can group common values without having to pack them together using something like JSON. 

For example, lets consider the traditional twitter clone with a `UserTimeline` CF that stores the tweets in a user's timeline. In this model I'm de-normalizing the tweets into the follower timeline just to illustrate the point. If we used a Standard CF we could populate as follows:

* row key with user name.
* column name with a time UUID (for the tweet id).
* column value with JSON data that holds the time stamp, author and message. 

Depending on your point of view, that can smell bad. So you may decide to use a Super Column Family as follows:

* row key is the user name.
* column name is the time UUID (for the tweet id).
* sub-column name is the name of the tweet property. 
* sub-column value is the property value.

No JSON no smell you may say. Super Columns Families have [their problems](http://wiki.apache.org/cassandra/CassandraLimitations), but in this we're probably not going to hit them. They are generally slower than Standard CF's however, and my personal preference is to avoid them if possible.  

Anytime we want to get a property of a tweet in a users timeline we can combine the tweet id (the column name) and the property name (sub-column name). Bish bash bosh, Composite Values and less chance of a [lost update](http://en.wikipedia.org/wiki/Write%E2%80%93write_conflict). You're away laughing. 

Except if you think that kind of smells. 

## CompositeType and and DynamicCompositeType

Cassandra 0.8.1 added the [CompositeType and and DynamicCompositeType](https://issues.apache.org/jira/browse/CASSANDRA-2231) comparators to support these sorts of use cases. The features was informed by work Ed Anuff [did](https://github.com/edanuff/CassandraCompositeType) when thinking about [indexing](http://www.anuff.com/2010/07/secondary-indexes-in-cassandra.html). Ed also did a presentation on using [composite types in with indexes](http://www.slideshare.net/edanuff/indexing-in-cassandra) at Cassandra SF 2011, right now that's the best information around on Composite Types.

The fields of a [CompositeType](https://github.com/apache/cassandra/blob/cassandra-0.8.6/src/java/org/apache/cassandra/db/marshal/CompositeType.java) are statically defined as part of the CF definition. While the [DynamicCompositeType](https://github.com/apache/cassandra/blob/cassandra-0.8.6/src/java/org/apache/cassandra/db/marshal/DynamicCompositeType.java) can be defined at write time, so in theory each value can have a different set of fields. I'm going to focus on the `CompositeType` in this post, hopefully I'll get to the `DynamicCompositeType` later.

## Type Definition

The first thing we need is a type definition language, like the one implemented in the [TypeParser](https://github.com/apache/cassandra/blob/cassandra-0.8.1/src/java/org/apache/cassandra/db/marshal/TypeParser.java) added by [CASSANDRA-2355](https://issues.apache.org/jira/browse/CASSANDRA-2355). I'm not aware of any documentation for the language so I've taken a crack at [BNF](http://en.wikipedia.org/wiki/Backus%E2%80%93Naur_Form) for it.


    <composite-definition> ::= <type-definition>[ ,...n ]

    <type-definition> ::= <type-name>[<type-parameters>]

    <type-name> ::= "AsciiType" | "BooleanType" | "BytesType" | "CounterColumnType" | 
    "DateType" | "DecimalType" | "DoubleType" | "FloatType" | "Int32" | "IntegerType" | 
    "LexicalUUIDType" | "LongType" | "UTF8Type" | "TimeUUIDType";

    <type-parameters> ::= "(" <parameter-value>[ ,...n ]  ")"

    <parameter-value> ::= parameter_name "=" parameter_value

It's probably easier to just show a couple of examples, we'll put some data in the CF's later. First (in `cassandra-cli`) create the Keyspace.

    create keyspace 
        composite_types;

    use composite_types;

Now a CF that use a composite type that sorts on a descending Long, followed by an ascending UTF8 string. Just the sort of thing you would want to use when storing a ordered / weighted / timestamped object where duplicates are allowed.

    CREATE COLUMN FAMILY 
        score_with_name
    WITH
        key_validation_class = 'AsciiType'
    AND
        comparator = 'AsciiType'
    AND
        comparator = 'CompositeType(LongType(reversed=true), UTF8Type)';

Or we could be sorted by last and then first name.

    CREATE COLUMN FAMILY 
        people
    WITH
        key_validation_class = 'AsciiType'
    AND
        comparator = 'AsciiType'
    AND
        comparator = 'CompositeType(UTF8Type, UTF8Type)';

*Note:* When using the CLI the type needs to be defined using a `string` delimetered by `''` rather than an identifier. So now days I just use a string for all CLI things.

That was fun, what about using them with a counter ? 

    CREATE COLUMN FAMILY 
        counters
    WITH 
        key_validation_class = 'AsciiType'
    AND
        comparator = 'AsciiType'
    AND
        default_validation_class = 'CompositeType(CounterColumnType, UTF8Type)';

Mmmm, that does not smell right to me....

    [default@composite_types] incr counters['foo']['bar']; 
null
InvalidRequestException(why:invalid operation for non commutative columnfamily counters)
    at org.apache.cassandra.thrift.Cassandra$add_result.read(Cassandra.java:16320)
    at org.apache.cassandra.thrift.Cassandra$Client.recv_add(Cassandra.java:903)
    at org.apache.cassandra.thrift.Cassandra$Client.add(Cassandra.java:875)
    at org.apache.cassandra.cli.CliClient.executeIncr(CliClient.java:961)
    at org.apache.cassandra.cli.CliClient.executeCLIStatement(CliClient.java:279)
    at org.apache.cassandra.cli.CliMain.processStatementInteractive(CliMain.java:222)
    at org.apache.cassandra.cli.CliMain.main(CliMain.java:350)
    
I've created a patch for that... XXX

**WARNING:** You can use a Composite Type anywhere you can use a type, however you should not use them for the `key_validation_class` without CASSANDRA-XXX.

## Storage

For `CompositeType`s, like normal types, the client library is responsible for serialising the value to types. Server side Cassandra validates the values, but otherwise stores the bytes given to it by the client. So there are a few more rules the client libraries have to follow, these are outlined in 



When it comes to storing Composite Types it's upda Well first we need to look at when the clients do, as the Cassandra server is not responsible for serialising values to bytes. 
 

